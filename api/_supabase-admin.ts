/**
 * Server-side Supabase admin client.
 * Uses the SERVICE ROLE key — bypasses RLS for privileged operations.
 *
 * NEVER import this file from client/ code.
 * NEVER expose SUPABASE_SERVICE_ROLE_KEY via VITE_ prefix.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../client/lib/database.types";

const url     = process.env.VITE_SUPABASE_URL!;
const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !svcKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. " +
    "Add them to .env.local — never commit secrets."
  );
}

export const adminSupabase = createClient<Database>(url, svcKey, {
  auth: {
    autoRefreshToken:  false,
    persistSession:    false,
    detectSessionInUrl: false,
  },
});
