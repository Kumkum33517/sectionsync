import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./_supabase-admin";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = process.env.VITE_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  // Test admin client
  const { data, error } = await adminSupabase.from("admins").select("email").limit(1);

  return res.status(200).json({
    hasUrl: !!url,
    hasSvcKey: !!svcKey,
    svcKeyPrefix: svcKey ? svcKey.substring(0, 10) : "missing",
    hasAnonKey: !!anonKey,
    adminQueryOk: !error,
    adminQueryError: error?.message ?? null,
    adminEmails: data?.map((r: any) => r.email) ?? [],
  });
}
