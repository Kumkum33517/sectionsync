/**
 * Admin specialization CRUD — rate limited + error sanitized.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, verifyAdmin, safeError } from "./_utils";

const ALLOWED = ["name", "batch", "description", "active"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const admin = await verifyAdmin(req);
  if ("error" in admin) return res.status(403).json(admin);


  if (req.method === "GET") {
    const { data, error } = await adminSupabase.from("specializations").select("*").order("name");
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ data });
  }

  if (req.method === "POST") {
    const { name, batch, description, active } = req.body ?? {};
    if (!name?.trim() || !batch?.trim()) return res.status(400).json({ error: "name and batch are required." });
    const { error } = await adminSupabase.from("specializations").insert({
      name: name.trim(), batch: batch.trim(),
      description: description?.trim() ?? null, active: active !== false,
    });
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: safeError(error) });
    return res.status(201).json({ ok: true });
  }

  if (req.method === "PUT") {
    const { id, ...rest } = req.body ?? {};
    if (!id) return res.status(400).json({ error: "id is required." });
    const updates = Object.fromEntries(ALLOWED.filter((k) => k in rest).map((k) => [k, rest[k]]));
    if (!Object.keys(updates).length) return res.status(400).json({ error: "No valid fields." });
    const { error } = await adminSupabase.from("specializations").update(updates).eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id is required." });
    const { count } = await adminSupabase.from("students")
      .select("id", { count: "exact", head: true }).eq("chosen_specialization_id", id);
    if ((count ?? 0) > 0) {
      return res.status(409).json({ error: "Cannot delete — students have already selected this specialization." });
    }
    const { error } = await adminSupabase.from("specializations").delete().eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed." });
}
