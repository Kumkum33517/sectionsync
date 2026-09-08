import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || supabaseUrl.includes("your-project")) {
  console.error("[SectionSync] VITE_SUPABASE_URL is missing. Add it to .env");
}
if (!supabaseAnonKey || supabaseAnonKey.includes("your-anon")) {
  console.error("[SectionSync] VITE_SUPABASE_ANON_KEY is missing. Add it to .env");
}

// Anon client — used in the browser.
// The anon key is public by design. RLS protects all data.
// Session is stored in HttpOnly cookies (set by Supabase Auth SSR helpers on deploy).
// For the SPA build we use the default storage but configure pkce for security.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession:    true,
    autoRefreshToken:  true,
    // pkce is more secure than implicit flow for OTP/magic-link
    flowType: "pkce",
    // Use localStorage for the SPA (browser-only).
    // On Vercel with SSR this would be replaced by @supabase/ssr
    // which sets HttpOnly Secure SameSite=Lax cookies automatically.
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});
