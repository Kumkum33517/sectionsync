/**
 * Admin section management — rate limited + error sanitized.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, verifyAdmin, safeError } from "./_utils";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const admin = await verifyAdmin(req);
  if ("error" in admin) return res.status(403).json(admin);

  const rl = await checkRateLimit({
    action: "admin_sections", email: admin.email, ip: getIp(req),
    perEmailLimit: 20, perIpLimit: 40, windowMinutes: 1,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  if (req.method === "GET") {
    const { data, error } = await adminSupabase
      .from("sections")
      .select("id, name, capacity, specialization_id, specialization:specialization_id(id,name,batch), seats(id,seat_number,student_id)")
      .order("name");
    if (error) return res.status(500).json({ error: safeError(error) });
    const enriched = (data ?? []).map((s: any) => ({
      ...s,
      occupancy: (s.seats ?? []).filter((seat: any) => seat.student_id !== null).length,
    }));
    return res.status(200).json({ data: enriched });
  }

  if (req.method === "POST") {
    const { specialization_id, name, capacity } = req.body ?? {};
    if (!specialization_id || !name?.trim()) {
      return res.status(400).json({ error: "specialization_id and name are required." });
    }
    const cap = typeof capacity === "number" ? capacity : 0;
    const { data, error } = await adminSupabase.from("sections")
      .insert({ specialization_id, name: name.trim(), capacity: cap })
      .select("id").single();
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: safeError(error) });
    return res.status(201).json({ ok: true, id: data.id });
  }

  if (req.method === "PUT") {
    const { id, capacity } = req.body ?? {};
    if (!id) return res.status(400).json({ error: "id is required." });
    if (typeof capacity !== "number" || capacity < 0) {
      return res.status(400).json({ error: "capacity must be a non-negative integer." });
    }
    const { error } = await adminSupabase.from("sections").update({ capacity }).eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id is required." });
    const { count } = await adminSupabase.from("seats")
      .select("id", { count: "exact", head: true })
      .eq("section_id", id).not("student_id","is",null);
    if ((count ?? 0) > 0) {
      return res.status(409).json({ error: "Cannot delete — students have booked seats in this section." });
    }
    const { error } = await adminSupabase.from("sections").delete().eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed." });
}
