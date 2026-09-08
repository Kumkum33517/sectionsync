/**
 * POST /api/send-otp
 *
 * Sends a real 6-digit OTP email via Supabase Auth signInWithOtp.
 * NOT a magic link — a numeric code the user types in.
 *
 * Rate limits: 3 per email / 5 per IP per 10 minutes.
 * Returns ok:true for both known and unknown emails (prevents enumeration).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { adminSupabase } from "./_supabase-admin";
import { handleCors, getIp } from "./_utils";

const SEND_LIMIT_EMAIL = 3;
const SEND_LIMIT_IP    = 5;
const WINDOW_MIN       = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const { email } = req.body ?? {};
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const em    = email.trim().toLowerCase();
  const ip    = getIp(req);
  const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000).toISOString();

  // ── Rate limiting ─────────────────────────────────────────────────
  const [byEmail, byIp] = await Promise.all([
    adminSupabase.from("otp_attempts")
      .select("id", { count: "exact", head: true })
      .eq("email", em).eq("action", "send").gte("created_at", since),
    adminSupabase.from("otp_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip).eq("action", "send").gte("created_at", since),
  ]);

  if ((byEmail.count ?? 0) >= SEND_LIMIT_EMAIL || (byIp.count ?? 0) >= SEND_LIMIT_IP) {
    return res.status(429).json({ error: "Too many OTP requests. Please wait a few minutes." });
  }

  // Log attempt first — before authorization check (prevents timing attacks)
  await adminSupabase.from("otp_attempts")
    .insert({ email: em, ip, action: "send", success: false });

  // ── Authorization check ───────────────────────────────────────────
  const [{ data: student }, { data: adminUser }] = await Promise.all([
    adminSupabase.from("students").select("id").eq("email", em).maybeSingle(),
    adminSupabase.from("admins").select("id").eq("email", em).maybeSingle(),
  ]);

  // Always return 200 — attacker can't enumerate valid emails
  if (!student && !adminUser) {
    return res.status(200).json({ ok: true });
  }

  // ── Send 6-digit OTP via anon client (signInWithOtp = numeric code, not a link)
  // The anon client is used here because signInWithOtp is a public auth operation.
  // The anon key is safe to use server-side — RLS + OTP expiry protect everything.
  const anonClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!
  );

  const { error: otpErr } = await anonClient.auth.signInWithOtp({
    email: em,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: "https://sectionsync.vercel.app/",
    },
  });

  if (otpErr) {
    console.error("[send-otp]", otpErr.message);
    return res.status(500).json({ error: "Failed to send OTP. Please try again." });
  }

  // Mark attempt as successful
  await adminSupabase.from("otp_attempts")
    .update({ success: true })
    .eq("email", em).eq("action", "send")
    .order("created_at", { ascending: false }).limit(1);

  return res.status(200).json({ ok: true });
}
