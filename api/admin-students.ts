/**
 * Admin student management — with rate limiting + error sanitization.
 *
 * GET    /api/admin-students        — list all
 * POST   /api/admin-students        — add single
 * PUT    /api/admin-students        — update
 * DELETE /api/admin-students?id=    — delete
 * POST   /api/admin-students/bulk   — bulk import
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, verifyAdmin, safeError } from "./_utils";

const ALLOWED_INSERT = ["roll_number", "name", "email", "year"] as const;
const ALLOWED_UPDATE = ["name", "roll_number", "year",
  "chosen_specialization_id", "assigned_section_id", "assigned_seat"] as const;

function pickInsert(body: Record<string, unknown>) {
  return Object.fromEntries(ALLOWED_INSERT.filter((k) => k in body).map((k) => [k, body[k]]));
}
function pickUpdate(body: Record<string, unknown>) {
  return Object.fromEntries(ALLOWED_UPDATE.filter((k) => k in body).map((k) => [k, body[k]]));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const admin = await verifyAdmin(req);
  if ("error" in admin) return res.status(403).json(admin);

  // Rate limit: 30 admin-student requests per minute per user
  const rl = await checkRateLimit({
    action: "admin_students", email: admin.email, ip: getIp(req),
    perEmailLimit: 30, perIpLimit: 60, windowMinutes: 1,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  // ── GET ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { data, error } = await adminSupabase
      .from("students")
      .select("id, roll_number, name, email, year, assigned_seat, chosen_specialization_id, assigned_section_id, specialization:chosen_specialization_id(id,name), section:assigned_section_id(id,name)")
      .order("roll_number");
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ data });
  }

  // ── POST single ──────────────────────────────────────────────────
  if (req.method === "POST" && !req.url?.includes("bulk")) {
    const fields = pickInsert(req.body ?? {});
    if (!fields.email || !fields.name || !fields.roll_number) {
      return res.status(400).json({ error: "name, email, and roll_number are required." });
    }
    if (typeof fields.email === "string" && !fields.email.endsWith("@ncuindia.edu")) {
      return res.status(400).json({ error: "Student emails must end with @ncuindia.edu" });
    }
    const { error } = await adminSupabase.from("students").insert(fields);
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: safeError(error) });

    // Auto-create auth account with default password
    const rollNumber = (fields.roll_number as string ?? "").toLowerCase();
    const { error: authErr } = await adminSupabase.auth.admin.createUser({
      email: (fields.email as string),
      password: `${rollNumber}@1234`,
      email_confirm: true,
    });
    if (!authErr) {
      const { data: authUser } = await adminSupabase.auth.admin.getUserByEmail(fields.email as string);
      if (authUser?.user) {
        await adminSupabase.from("students").update({ auth_id: authUser.user.id }).eq("email", fields.email);
      }
    }
    return res.status(201).json({ ok: true });
  }

  // ── POST bulk ────────────────────────────────────────────────────
  if (req.method === "POST" && req.url?.includes("bulk")) {
    const rows: Record<string, unknown>[] = req.body?.students ?? [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "students array is required." });
    }
    const clean = rows
      .map((r) => pickInsert(r as Record<string, unknown>))
      .filter((r) => r.email && r.name && r.roll_number);
    if (clean.length === 0) return res.status(400).json({ error: "No valid student rows found." });

    // Upsert students table first
    const { data, error } = await adminSupabase
      .from("students")
      .upsert(clean as any, { onConflict: "email", ignoreDuplicates: true })
      .select("id, email, roll_number");
    if (error) return res.status(500).json({ error: safeError(error) });

    // Auto-create Supabase Auth accounts with default password rollnumber@1234
    let authCreated = 0;
    for (const student of data ?? []) {
      const defaultPassword = `${(student.roll_number as string).toLowerCase()}@1234`;
      // createUser will fail silently if user already exists — that's fine
      const { error: authErr } = await adminSupabase.auth.admin.createUser({
        email: student.email as string,
        password: defaultPassword,
        email_confirm: true, // skip email confirmation
      });
      if (!authErr) {
        authCreated++;
        // Link auth_id back to students row
        const { data: authUser } = await adminSupabase.auth.admin.getUserByEmail(student.email as string);
        if (authUser?.user) {
          await adminSupabase.from("students")
            .update({ auth_id: authUser.user.id })
            .eq("email", student.email);
        }
      }
    }

    return res.status(200).json({ ok: true, inserted: data?.length ?? 0, authCreated });
  }

  // ── PUT ──────────────────────────────────────────────────────────
  if (req.method === "PUT") {
    const { id, ...rest } = req.body ?? {};
    if (!id) return res.status(400).json({ error: "id is required." });
    const updates = pickUpdate(rest);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update." });
    const { error } = await adminSupabase.from("students").update(updates).eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE ───────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id is required." });
    const { error } = await adminSupabase.from("students").delete().eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed." });
}
