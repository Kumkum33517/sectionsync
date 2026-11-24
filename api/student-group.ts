/**
 * POST /api/student-group
 *
 * Saves a student's self-selected group number (1 or 2).
 * Authenticated as the student themselves — uses their own token.
 * Only allowed while the section-selection window is open and the
 * student already has an assigned section.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, safeError } from "./_utils";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  // ── Authenticate student ────────────────────────────────────────
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

  // ── Rate limit ─────────────────────────────────────────────────
  const ip = getIp(req);
  const rl = await checkRateLimit({
    action: "student_group", email: user.email, ip,
    perEmailLimit: 20, perIpLimit: 40, windowMinutes: 1,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  // ── Validate body ──────────────────────────────────────────────
  const { group_number } = req.body ?? {};
  if (group_number !== 1 && group_number !== 2) {
    return res.status(400).json({ error: "group_number must be 1 or 2." });
  }

  // ── Window must be open ────────────────────────────────────────
  const { data: config } = await adminSupabase
    .from("system_config").select("phase, section_window_open, section_window_new_only").eq("id", 1).single();
  if (!config?.section_window_open) {
    return res.status(403).json({ error: "Section selection window is not open." });
  }
  if (config?.section_window_new_only) {
    const { data: existing } = await adminSupabase
      .from("students").select("group_number").eq("id", student.id).maybeSingle();
    if (existing?.group_number) {
      return res.status(403).json({ error: "The section window is open for new students only. Your group is already set." });
    }
  }

  // ── Student must have an assigned section ──────────────────────
  const { data: student, error: sErr } = await adminSupabase
    .from("students")
    .select("id, assigned_section_id")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  if (sErr || !student) return res.status(403).json({ error: "Student record not found." });
  if (!student.assigned_section_id) {
    return res.status(403).json({ error: "You must book a seat before choosing a group." });
  }

  // ── Check group capacity ───────────────────────────────────────
  const { data: section } = await adminSupabase
    .from("sections").select("capacity").eq("id", student.assigned_section_id).maybeSingle();
  if (!section) return res.status(404).json({ error: "Section not found." });

  const g1Cap = Math.ceil(section.capacity / 2);
  const g2Cap = section.capacity - g1Cap;
  const targetCap = group_number === 1 ? g1Cap : g2Cap;

  const { count: currentCount } = await adminSupabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("assigned_section_id", student.assigned_section_id)
    .eq("group_number", group_number)
    .neq("id", student.id); // don't count this student's own existing choice

  if ((currentCount ?? 0) >= targetCap) {
    return res.status(409).json({ error: `Group ${group_number} is full. Please choose the other group.` });
  }

  // ── Save ───────────────────────────────────────────────────────
  const { error: updateErr } = await adminSupabase
    .from("students")
    .update({ group_number })
    .eq("id", student.id);

  if (updateErr) {
    console.error("[student-group] update error:", updateErr.message);
    return res.status(500).json({ error: safeError(updateErr) });
  }

  return res.status(200).json({ ok: true });
}
