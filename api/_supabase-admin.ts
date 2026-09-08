/**
 * Server-side Supabase admin client.
 * Uses the SERVICE ROLE key — bypasses RLS for privileged operations.
 *
 * NEVER import this file from client/ code.
 * NEVER expose SUPABASE_SERVICE_ROLE_KEY via VITE_ prefix.
 */
import { createClient } from "@supabase/supabase-js";

const url    = process.env.VITE_SUPABASE_URL ?? "";
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !svcKey) {
  console.error(
    "[SectionSync] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
    "Add them to Vercel Environment Variables."
  );
}

export const adminSupabase = createClient(url, svcKey, {
  auth: {
    autoRefreshToken:   false,
    persistSession:     false,
    detectSessionInUrl: false,
  },
});
