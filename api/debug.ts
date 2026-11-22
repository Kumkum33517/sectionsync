import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { adminSupabase } from "./_supabase-admin";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = process.env.VITE_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();

  // Test admin client
  const { data: adminsData, error: adminsErr } = await adminSupabase.from("admins").select("email").limit(1);

  // Test getUser with bearer token (same as verifyAdmin does)
  let getUserResult = "no token provided";
  if (token) {
    const userClient = createClient(url!, anonKey!, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    // @ts-ignore — TS5 type compat
    const { data: ud, error: ue } = await userClient.auth.getUser();
    getUserResult = ue ? `ERROR: ${ue.message}` : `OK: ${ud.user?.email}`;
  }

  return res.status(200).json({
    hasUrl: !!url,
    hasSvcKey: !!svcKey,
    svcKeyPrefix: svcKey ? svcKey.substring(0, 10) : "missing",
    hasAnonKey: !!anonKey,
    adminQueryOk: !adminsErr,
    adminEmails: adminsData?.map((r: any) => r.email) ?? [],
    getUserResult,
  });
}
