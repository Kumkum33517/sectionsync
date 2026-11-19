/**
 * POST /api/change-password
 *
 * Requires valid JWT. Updates the authenticated user's password.
 * Body: { new_password: string }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { handleCors, getIp, checkRateLimit } from "./_utils";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Authentication required." });

  const { new_password } = req.body ?? {};
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const ip = getIp(req);
  const rl = await checkRateLimit({
    action: "change_password", ip,
    perIpLimit: 10, windowMinutes: 10,
  });
  if (rl.limited) return res.status(429).json({ error: rl.message });

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  // @ts-ignore — TS5 type compat
  const { error } = await userClient.auth.updateUser({ password: new_password });
  if (error) return res.status(400).json({ error: "Failed to update password. Please try again." });

  return res.status(200).json({ ok: true });
}
