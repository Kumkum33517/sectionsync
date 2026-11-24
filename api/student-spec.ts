/**
 * POST /api/student-spec
 * Saves a student's specialization selection to the database.
 * Authenticated as the student themselves — uses their token.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, safeError } from "./_utils";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  // Authenticate the student
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Authentication required." });

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  // @ts-ignore — TS5 type compat
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user?.email) return res.status(401).json({ error: "Invalid or expired session." });

  // Rate limit
  const ip = getIp(req);
  const rl = await checkRateLimit({
    action: "student_spec", email: user.email, ip,
    perEmailLimit: 20, perIpLimit: 40, windowMinutes: 1,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  const { specialization_id } = req.body ?? {};
  if (!specialization_id || typeof specialization_id !== "string") {
    return res.status(400).json({ error: "specialization_id is required." });
  }

  // Verify spec window is open
  const { data: config } = await adminSupabase
    .from("system_config").select("phase, spec_window_new_only").eq("id", 1).single();
  if (config?.phase !== "SPEC_WINDOW_OPEN") {
    return res.status(403).json({ error: "Specialization window is not open." });
  }

  // If the window is open for new students only, block students who already have a specialization
  if (config?.spec_window_new_only) {
    const { data: existing } = await adminSupabase
      .from("students")
      .select("chosen_specialization_id")
      .eq("email", user.email.toLowerCase())
      .maybeSingle();
    if (existing?.chosen_specialization_id) {
      return res.status(403).json({ error: "The specialization window is currently open for new students only. Your existing selection is locked." });
    }
  }

  // Verify specialization exists and is active
  const { data: spec } = await adminSupabase
    .from("specializations").select("id, active").eq("id", specialization_id).maybeSingle();
  if (!spec || !spec.active) {
    return res.status(404).json({ error: "Specialization not found or inactive." });
  }

  // Update the student's chosen_specialization_id
  const { error } = await adminSupabase
    .from("students")
    .update({ chosen_specialization_id: specialization_id })
    .eq("email", user.email.toLowerCase());

  if (error) {
    console.error("[student-spec] update error:", error.message);
    return res.status(500).json({ error: safeError(error) });
  }

  return res.status(200).json({ ok: true });
}
