/**
 * POST /api/sign-in
 *
 * Email + password authentication.
 * Returns { ok, role, access_token, refresh_token, expires_at }
 */
const { createClient } = require("@supabase/supabase-js");
const { adminSupabase } = require("./_supabase-admin");
const { handleCors, getIp, checkRateLimit, safeError } = require("./_utils");

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const em = email.trim().toLowerCase();
  const ip = getIp(req);

  // Rate limit: 5 attempts per email per 10 minutes
  const rl = await checkRateLimit({
    action: "sign_in", email: em, ip,
    perEmailLimit: 5, perIpLimit: 20, windowMinutes: 10,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  // Sign in with Supabase Auth
  const anonClient = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
  );

  const { data, error } = await anonClient.auth.signInWithPassword({ email: em, password });

  if (error || !data.session) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  // Determine role server-side
  const { data: adminRow } = await adminSupabase
    .from("admins").select("id").eq("email", em).maybeSingle();

  // Link auth_id to student record on first login
  if (!adminRow) {
    await adminSupabase.from("students")
      .update({ auth_id: data.user.id })
      .eq("email", em).is("auth_id", null);
  }

  return res.status(200).json({
    ok:            true,
    role:          adminRow ? "admin" : "student",
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at:    data.session.expires_at,
  });
};
