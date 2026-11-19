import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const envLocal = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const serviceKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();
const url = "https://knfhyaqfbvasmowuaczl.supabase.co";

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

// List all users and find/fix each admin
const { data: all } = await supabase.auth.admin.listUsers({ perPage: 1000 });
console.log("Total users in Supabase Auth:", all?.users?.length ?? 0);

for (const email of admins) {
  const existing = all?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    // Update password on existing user
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error) console.error(`Update failed ${email}:`, error.message);
    else console.log(`Updated password for ${email}`);
  } else {
    // Create new
    const { data, error } = await supabase.auth.admin.createUser({
      email, password: ADMIN_PASSWORD, email_confirm: true,
    });
    if (error) console.error(`Create failed ${email}:`, error.message);
    else console.log(`Created ${email}`);
  }
}

console.log("\nAll admins ready. Password:", ADMIN_PASSWORD);
