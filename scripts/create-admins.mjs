/**
 * Run this ONCE locally to create admin accounts in Supabase Auth:
 * node scripts/create-admins.mjs
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read .env.local
const envLocal = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const serviceKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();
const url = "https://knfhyaqfbvasmowuaczl.supabase.co";

if (!serviceKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY not found in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ADMIN_PASSWORD = "Admin!@9182";

const admins = [
  "manvibreja@ncuindia.edu",
  "kumkum33517@gmail.com",
  "kumkum17335@gmail.com",
  "23csu173@ncuindia.edu",
];

for (const email of admins) {
  // Try to delete existing user first (clean slate)
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing?.users?.find(u => u.email === email);
  if (found) {
    await supabase.auth.admin.deleteUser(found.id);
    console.log(`Deleted existing: ${email}`);
  }

  // Create fresh
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });

  if (error) {
    console.error(`Failed ${email}:`, error.message);
  } else {
    console.log(`Created ${email} (id: ${data.user.id})`);
  }
}

console.log("\nDone. All admins created with password:", ADMIN_PASSWORD);
