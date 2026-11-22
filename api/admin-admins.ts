/**
 * Admin access management — rate limited + error sanitized.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, verifyAdmin, safeError } from "./_utils";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const admin = await verifyAdmin(req);
  if ("error" in admin) return res.status(403).json(admin);


  if (req.method === "GET") {
    const { data, error } = await adminSupabase
      .from("admins").select("id, email, name, role, added_at").order("added_at");
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ data });
  }

  if (req.method === "POST") {
    const { name, email, role } = req.body ?? {};
    if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: "name and email are required." });
    if (!["primary","team"].includes(role)) return res.status(400).json({ error: "role must be 'primary' or 'team'." });
    const em = (email as string).trim().toLowerCase();

    const { data: student } = await adminSupabase.from("students").select("id").eq("email", em).maybeSingle();
    if (student) return res.status(409).json({ error: "That email belongs to a student — lists cannot overlap." });

    const { data: inserted, error } = await adminSupabase
      .from("admins").insert({ name: name.trim(), email: em, role }).select("id").single();
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: safeError(error) });

    // Create Supabase Auth account with a default password so they can sign in immediately
    // @ts-ignore — TS5 type compat
    await adminSupabase.auth.admin.createUser({
      email: em,
      password: "admin@sectionsync1",
      email_confirm: true,
    });

    return res.status(201).json({ ok: true, id: inserted.id });
  }

  if (req.method === "DELETE") {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id is required." });
    const { data: row } = await adminSupabase.from("admins").select("email").eq("id", id).maybeSingle();
    if (!row) return res.status(404).json({ error: "Admin not found." });
    if (row.email.toLowerCase() === admin.email) {
      return res.status(403).json({ error: "You cannot remove your own admin access." });
    }
    const { error } = await adminSupabase.from("admins").delete().eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });

    // Also delete their Supabase Auth account so they can no longer sign in
    // @ts-ignore — TS5 type compat
    const { data: authUser } = await adminSupabase.auth.admin.getUserByEmail(row.email);
    if (authUser?.user?.id) {
      // @ts-ignore — TS5 type compat
      await adminSupabase.auth.admin.deleteUser(authUser.user.id);
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed." });
}
