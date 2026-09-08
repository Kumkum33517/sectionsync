/**
 * POST /api/verify-otp
 *
 * Verifies the 6-digit OTP sent by send-otp (via Supabase Auth signInWithOtp).
 * Uses verifyOtp with type "email" — matches signInWithOtp flow exactly.
 *
 * Body: { email: string; otp: string }   ← "otp" not "token"
 * Returns: { ok, role, access_token, refresh_token, expires_at }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp } from "./_utils";

const VERIFY_LIMIT = 5;
const WINDOW_MIN   = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  // Accept "otp" — matches what the frontend sends
  const { email, otp } = req.body ?? {};
  if (!email || !otp || typeof email !== "string" || typeof otp !== "string") {
    return res.status(400).json({ error: "Email and OTP are required." });
  }

  const em    = email.trim().toLowerCase();
  const code  = otp.trim();
  const ip    = getIp(req);
  const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000).toISOString();

  // ── Rate limiting ─────────────────────────────────────────────────
  const { count } = await adminSupabase.from("otp_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email", em).eq("action", "verify").gte("created_at", since);

  if ((count ?? 0) >= VERIFY_LIMIT) {
    return res.status(429).json({ error: "Too many verification attempts. Please request a new OTP." });
  }

  await adminSupabase.from("otp_attempts")
    .insert({ email: em, ip, action: "verify", success: false });

  // ── Verify OTP ────────────────────────────────────────────────────
  // verifyOtp with type "email" is the correct counterpart to signInWithOtp.
  // The anon client is used because verifyOtp is a public auth operation.
  const anonClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!
  );

  const { data, error } = await anonClient.auth.verifyOtp({
    email: em,
    token: code,    // "token" here is Supabase's internal param name for the 6-digit code
    type:  "email", // must match the type used in signInWithOtp
  });

  if (error || !data.session || !data.user) {
    // Generic message — don't reveal whether email was valid
    return res.status(400).json({ error: "Incorrect or expired OTP. Please try again." });
  }

  // Mark success
  await adminSupabase.from("otp_attempts")
    .update({ success: true })
    .eq("email", em).eq("action", "verify")
    .order("created_at", { ascending: false }).limit(1);

  // Link auth.users.id → students.auth_id on first login
  await adminSupabase.from("students")
    .update({ auth_id: data.user.id })
    .eq("email", em)
    .is("auth_id", null);

  // Determine role server-side — never trust the client for this
  const { data: adminRow } = await adminSupabase
    .from("admins").select("id").eq("email", em).maybeSingle();

  return res.status(200).json({
    ok:            true,
    role:          adminRow ? "admin" : "student",
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at:    data.session.expires_at,
  });
}
