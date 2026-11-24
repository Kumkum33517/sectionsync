/**
 * POST /api/book-seat
 *
 * Atomically books a seat via the book_seat() PostgreSQL function.
 * Authenticated, rate-limited, error-sanitized.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp, checkRateLimit, safeError } from "./_utils";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  // ── Authenticate ────────────────────────────────────────────────
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Authentication required." });

  const userSupabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  // @ts-ignore — TS5 type compat
  const { data: { user }, error: authErr } = await userSupabase.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: "Invalid or expired session." });

  // ── Rate limit (10 booking attempts per user per minute) ────────
  const ip = getIp(req);
  const limited = await checkRateLimit({
    action: "book_seat",
    email:  user.email,
    ip,
    perEmailLimit: 10,
    perIpLimit:    20,
    windowMinutes: 1,
  });
  if (limited.limited) return res.status(429).json({ error: limited.message });

  // ── Validate body ───────────────────────────────────────────────
  const { section_id, seat_number } = req.body ?? {};
  if (!section_id || typeof section_id !== "string") {
    return res.status(400).json({ error: "section_id is required." });
  }
  if (!Number.isInteger(seat_number) || seat_number < 1) {
    return res.status(400).json({ error: "seat_number must be a positive integer." });
  }

  // ── Resolve student record ──────────────────────────────────────
  const { data: student, error: sErr } = await adminSupabase
    .from("students").select("id").eq("auth_id", user.id).maybeSingle();
  if (sErr || !student) return res.status(403).json({ error: "No student record found for your account." });

  // ── Window check ────────────────────────────────────────────────
  const { data: config } = await adminSupabase
    .from("system_config").select("section_window_open, section_window_new_only").eq("id", 1).single();
  if (!config?.section_window_open) {
    return res.status(403).json({ error: "Section selection window is currently closed." });
  }

  // If open for new students only, block students who already have an assigned section
  if (config?.section_window_new_only) {
    const { data: existing } = await adminSupabase
      .from("students").select("assigned_section_id").eq("id", student.id).maybeSingle();
    if (existing?.assigned_section_id) {
      return res.status(403).json({ error: "The section window is currently open for new students only. Your existing seat is locked." });
    }
  }

  // ── Atomic booking via DB function ──────────────────────────────
  const { data: result, error: fnErr } = await adminSupabase.rpc("book_seat", {
    p_student_id:  student.id,
    p_section_id:  section_id,
    p_seat_number: seat_number,
  });

  if (fnErr) {
    console.error("[book-seat] RPC:", fnErr.message);
    return res.status(500).json({ error: "Booking failed. Please try again." });
  }

  const outcomes: Record<string, { status: number; error: string }> = {
    seat_taken:           { status: 409, error: "That seat was just taken. Please choose a different seat." },
    window_closed:        { status: 403, error: "Section selection window is currently closed." },
    wrong_specialization: { status: 403, error: "That section belongs to a different specialization than yours." },
    invalid_seat:         { status: 400, error: "Invalid seat number for that section." },
    student_not_found:    { status: 404, error: "Student record not found." },
    section_not_found:    { status: 404, error: "Section not found." },
  };

  if (result !== "ok") {
    const mapped = outcomes[result as string] ?? { status: 500, error: "Booking failed." };
    return res.status(mapped.status).json({ error: mapped.error });
  }

  return res.status(200).json({ ok: true });
}
