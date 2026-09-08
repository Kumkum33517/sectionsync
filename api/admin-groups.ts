/**
 * POST /api/admin-groups
 *
 * Assigns G1/G2 groups to all seated students across all sections.
 * Called by admin when closing the section-selection window.
 *
 * Logic: students sorted by seat number within their section.
 * First ceil(n/2) → G1, rest → G2.
 * e.g. 50 students → 25 G1 + 25 G2
 *      49 students → 25 G1 + 24 G2
 *
 * Admin only. Rate limited.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, verifyAdmin, safeError } from "./_utils";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const admin = await verifyAdmin(req);
  if ("error" in admin) return res.status(403).json(admin);

  const rl = await checkRateLimit({
    action: "admin_groups", email: admin.email, ip: getIp(req),
    perEmailLimit: 5, perIpLimit: 10, windowMinutes: 1,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  // Call the DB function that assigns groups atomically
  const { data, error } = await adminSupabase.rpc("assign_groups");

  if (error) {
    console.error("[admin-groups]", error.message);
    return res.status(500).json({ error: safeError(error, "Failed to assign groups.") });
  }

  return res.status(200).json({ ok: true, studentsAssigned: data });
}
