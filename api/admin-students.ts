/**
 * Admin student management — fully self-contained, no shared imports.
 * All utilities inlined to avoid Vercel cross-bundle compilation issues.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

// ── Inline admin client ──────────────────────────────────────────
function makeAdmin() {
  return createClient(
    process.env.VITE_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  );
}

// ── Inline CORS ──────────────────────────────────────────────────
function cors(req: VercelRequest, res: VercelResponse): boolean {
  const allowed = ["https://sectionsync.vercel.app", "http://localhost:8080", "http://localhost:3000"];
  const origin = req.headers.origin ?? "";
  if (allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

// ── Inline IP ────────────────────────────────────────────────────
function getIp(req: VercelRequest): string {
  return (req.headers["x-forwarded-for"] as string ?? "").split(",")[0].trim() || "unknown";
}

// ── Inline safe error ────────────────────────────────────────────
function safeError(error: { code?: string; message?: string } | null): string {
  const CODES: Record<string, string> = {
    "23505": "A record with that value already exists.",
    "23503": "Referenced record does not exist.",
    "23502": "A required field is missing.",
  };
  if (!error) return "An error occurred.";
  if (error.code && CODES[error.code]) return CODES[error.code];
  return "An error occurred.";
}

// ── Inline admin verification ────────────────────────────────────
async function verifyAdmin(req: VercelRequest): Promise<{ error: string } | { email: string }> {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Authentication required." };

  const anonClient = createClient(
    process.env.VITE_SUPABASE_URL ?? "",
    process.env.VITE_SUPABASE_ANON_KEY ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  // @ts-ignore — TS5 type compat
  const { data: { user }, error } = await anonClient.auth.getUser();
  if (error || !user?.email) return { error: "Invalid or expired session." };

  const admin = makeAdmin();
  const { data: adminRow } = await admin
    .from("admins").select("id").eq("email", user.email.toLowerCase()).maybeSingle();

  if (!adminRow) return { error: "Admin access required." };
  return { email: user.email.toLowerCase() };
}

// ── Inline rate limit ────────────────────────────────────────────
async function checkRate(email: string, ip: string): Promise<boolean> {
  const admin = makeAdmin();
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const [byEmail, byIp] = await Promise.all([
    admin.from("rate_limit_log").select("id", { count: "exact", head: true })
      .eq("email", email).eq("action", "admin_students").gte("created_at", since),
    admin.from("rate_limit_log").select("id", { count: "exact", head: true })
      .eq("ip", ip).eq("action", "admin_students").gte("created_at", since),
  ]);
  if ((byEmail.count ?? 0) >= 30 || (byIp.count ?? 0) >= 60) return true;
  await admin.from("rate_limit_log").insert({ email, ip, action: "admin_students" });
  return false;
}

// ── Field allowlists ─────────────────────────────────────────────
const ALLOWED_INSERT = ["roll_number", "name", "email", "year"] as const;
const ALLOWED_UPDATE = ["name", "roll_number", "year",
  "chosen_specialization_id", "assigned_section_id", "assigned_seat"] as const;

function pickInsert(body: Record<string, unknown>) {
  return Object.fromEntries(ALLOWED_INSERT.filter((k) => k in body).map((k) => [k, body[k]]));
}
function pickUpdate(body: Record<string, unknown>) {
  return Object.fromEntries(ALLOWED_UPDATE.filter((k) => k in body).map((k) => [k, body[k]]));
}

// ── Handler ──────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const adminCheck = await verifyAdmin(req);
  if ("error" in adminCheck) return res.status(403).json(adminCheck);

  const ip = getIp(req);
  const limited = await checkRate(adminCheck.email, ip);
  if (limited) return res.status(429).json({ error: "Too many requests." });

  const admin = makeAdmin();

  // ── GET ────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { data, error } = await admin.from("students")
      .select("id, roll_number, name, email, year, assigned_seat, chosen_specialization_id, assigned_section_id, specialization:chosen_specialization_id(id,name), section:assigned_section_id(id,name)")
      .order("roll_number");
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ data });
  }

  // ── POST bulk (body has students array) ───────────────────────
  if (req.method === "POST" && Array.isArray(req.body?.students)) {
    const rows: Record<string, unknown>[] = req.body.students;
    const replaceAll: boolean = req.body.replace === true;
    if (rows.length === 0) return res.status(400).json({ error: "students array is required." });

    const clean = rows.map((r) => pickInsert(r)).filter((r) => r.email && r.name && r.roll_number);
    if (clean.length === 0) return res.status(400).json({ error: "No valid student rows found." });

    // If replace mode — delete directly using admin client (service_role bypasses RLS)
    if (replaceAll) {
      // Step 1: nullify seats.student_id FK (seats → students)
      await admin.from("seats").update({ student_id: null, booked_at: null }).not("id", "is", null);
      // Step 2: nullify student FK columns so the row can be deleted
      const { error: nullifyErr } = await admin.from("students").update({
        auth_id: null,
        chosen_specialization_id: null,
        assigned_section_id: null,
        assigned_seat: null,
      }).not("id", "is", null);
      if (nullifyErr) {
        console.error("[admin-students] nullify error:", nullifyErr.message);
        return res.status(500).json({ error: "Failed to clear existing student data." });
      }
      // Step 3: delete all student rows
      const { error: deleteErr } = await admin.from("students").delete().not("id", "is", null);
      if (deleteErr) {
        console.error("[admin-students] delete error:", deleteErr.message);
        return res.status(500).json({ error: "Failed to delete existing students." });
      }
    }

    const { data, error } = await admin.from("students")
      .upsert(clean as any, { onConflict: "email", ignoreDuplicates: !replaceAll })
      .select("id, email, roll_number");
    if (error) {
      console.error("[admin-students] upsert error:", error.code, error.message, error.details);
      return res.status(500).json({ error: error.message ?? safeError(error) });
    }

    // Fire-and-forget: create auth accounts in background without blocking the response.
    // sign-in.ts handles auth_id linking lazily on first login for any gaps.
    const students = data ?? [];
    (async () => {
      const BATCH = 20;
      for (let i = 0; i < students.length; i += BATCH) {
        const batch = students.slice(i, i + BATCH);
        await Promise.all(batch.map(async (student) => {
          const defaultPassword = `${(student.roll_number as string).toLowerCase()}@1234`;
          // @ts-ignore — TS5 type compat
          const { data: created, error: authErr } = await admin.auth.admin.createUser({
            email: student.email as string,
            password: defaultPassword,
            email_confirm: true,
          });
          if (!authErr && created?.user) {
            await admin.from("students")
              .update({ auth_id: created.user.id })
              .eq("email", student.email);
          }
        }));
      }
    })().catch((e) => console.error("[admin-students] background auth creation error:", e));

    return res.status(200).json({ ok: true, inserted: students.length });
  }

  // ── POST single ───────────────────────────────────────────────
  if (req.method === "POST") {
    const fields = pickInsert(req.body ?? {});
    if (!fields.email || !fields.name || !fields.roll_number) {
      return res.status(400).json({ error: "name, email, and roll_number are required." });
    }
    if (typeof fields.email === "string" && !fields.email.endsWith("@ncuindia.edu")) {
      return res.status(400).json({ error: "Student emails must end with @ncuindia.edu" });
    }
    const { error } = await admin.from("students").insert(fields);
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: safeError(error) });

    const rollNumber = (fields.roll_number as string ?? "").toLowerCase();
    // @ts-ignore — TS5 type compat
    const { data: createdUser, error: authErr } = await admin.auth.admin.createUser({
      email: fields.email as string,
      password: `${rollNumber}@1234`,
      email_confirm: true,
    });
    if (!authErr && createdUser?.user) {
      await admin.from("students").update({ auth_id: createdUser.user.id }).eq("email", fields.email);
    }
    return res.status(201).json({ ok: true });
  }

  // ── PUT ───────────────────────────────────────────────────────
  if (req.method === "PUT") {
    const { id, ...rest } = req.body ?? {};
    if (!id) return res.status(400).json({ error: "id is required." });
    const updates = pickUpdate(rest);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields." });
    const { error } = await admin.from("students").update(updates).eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE ────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id is required." });
    const { error } = await admin.from("students").delete().eq("id", id);
    if (error) return res.status(500).json({ error: safeError(error) });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed." });
}
