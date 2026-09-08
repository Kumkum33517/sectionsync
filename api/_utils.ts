/**
 * Shared API utilities:
 *  - safeError()       — sanitize DB/internal errors before sending to client
 *  - checkRateLimit()  — per-IP + per-user rate limiting for any route
 *  - verifyAdmin()     — reusable admin JWT verification
 *  - handleCors()      — handle OPTIONS preflight
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";
import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────
// Error sanitization
// Never leak raw Supabase / Postgres error messages to the client.
// They can reveal table names, column names, constraint names, etc.
// ─────────────────────────────────────────────────────────────────

const SAFE_CODES: Record<string, string> = {
  "23505": "A record with that value already exists.",
  "23503": "Referenced record does not exist.",
  "23502": "A required field is missing.",
  "42501": "Insufficient permissions.",
  "PGRST116": "Record not found.",
  "PGRST301": "Row-level security policy violation.",
};

export function safeError(error: { code?: string; message?: string } | null, fallback = "An error occurred."): string {
  if (!error) return fallback;
  // Return a safe mapped message if we know this error code
  if (error.code && SAFE_CODES[error.code]) return SAFE_CODES[error.code];
  // Never return raw DB messages in production
  if (process.env.NODE_ENV === "development") return error.message ?? fallback;
  return fallback;
}

// ─────────────────────────────────────────────────────────────────
// Rate limiting
// Uses the otp_attempts table with a generic action name.
// Limits: per-IP and per-user (email).
// ─────────────────────────────────────────────────────────────────

interface RateLimitOptions {
  action: string;
  email?: string;
  ip: string;
  perEmailLimit?: number;   // max requests per email per window
  perIpLimit?: number;      // max requests per IP per window
  windowMinutes?: number;
}

export async function checkRateLimit(opts: RateLimitOptions): Promise<{ limited: boolean; message: string }> {
  const {
    action, email, ip,
    perEmailLimit = 20,
    perIpLimit    = 50,
    windowMinutes = 1,
  } = opts;

  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const checks: Promise<{ count: number | null }>[] = [];

  if (email) {
    checks.push(
      adminSupabase
        .from("rate_limit_log")
        .select("id", { count: "exact", head: true })
        .eq("email", email.toLowerCase())
        .eq("action", action)
        .gte("created_at", since)
        .then((r) => ({ count: r.count }))
    );
  }

  checks.push(
    adminSupabase
      .from("rate_limit_log")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .eq("action", action)
      .gte("created_at", since)
      .then((r) => ({ count: r.count }))
  );

  const results = await Promise.all(checks);

  if (email && (results[0]?.count ?? 0) >= perEmailLimit) {
    return { limited: true, message: "Too many requests. Please slow down." };
  }
  const ipResult = email ? results[1] : results[0];
  if ((ipResult?.count ?? 0) >= perIpLimit) {
    return { limited: true, message: "Too many requests from this network. Please try again later." };
  }

  // Log the attempt to the general rate limit table (no action CHECK constraint here)
  await adminSupabase.from("rate_limit_log").insert({
    email: email ?? "unknown",
    ip,
    action,
  });

  return { limited: false, message: "" };
}

// ─────────────────────────────────────────────────────────────────
// Admin verification (shared across all admin routes)
// ─────────────────────────────────────────────────────────────────

export async function verifyAdmin(
  req: VercelRequest
): Promise<{ error: string } | { email: string; userId: string }> {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Authentication required." };

  const userSupabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error } = await userSupabase.auth.getUser();
  if (error || !user?.email) return { error: "Invalid or expired session." };

  const { data: adminRow } = await adminSupabase
    .from("admins")
    .select("id")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  if (!adminRow) return { error: "Admin access required." };
  return { email: user.email.toLowerCase(), userId: user.id };
}

// ─────────────────────────────────────────────────────────────────
// CORS preflight handler
// ─────────────────────────────────────────────────────────────────

export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  const allowedOrigins = [
    "https://sectionsync.vercel.app",
    "http://localhost:8080",
    "http://localhost:3000",
  ];
  const origin = req.headers.origin ?? "";
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true; // caller should return immediately
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Extract client IP safely
// ─────────────────────────────────────────────────────────────────
export function getIp(req: VercelRequest): string {
  return (
    (req.headers["x-forwarded-for"] as string ?? "")
      .split(",")[0]
      .trim() || "unknown"
  );
}
