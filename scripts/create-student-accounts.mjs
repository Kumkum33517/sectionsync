/**
 * Run ONCE to create Supabase Auth accounts for all existing students.
 * node scripts/create-student-accounts.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envLocal = readFileSync(".env.local", "utf8");
const serviceKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();
const url = "https://knfhyaqfbvasmowuaczl.supabase.co";

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Get all students without auth_id
const { data: students, error } = await supabase
  .from("students")
  .select("id, email, roll_number, auth_id")
  .is("auth_id", null);

if (error) { console.error("Failed to fetch students:", error.message); process.exit(1); }
console.log(`Found ${students.length} students without auth accounts.`);

let created = 0, skipped = 0, failed = 0;

for (const student of students) {
  const defaultPassword = `${student.roll_number.toLowerCase()}@1234`;

  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: student.email,
    password: defaultPassword,
    email_confirm: true,
  });

  if (authErr) {
    if (authErr.message.includes("already been registered")) {
      // User exists in auth but auth_id not linked — find and link
      const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const existing = users?.find(u => u.email === student.email);
      if (existing) {
        await supabase.from("students").update({ auth_id: existing.id }).eq("id", student.id);
        skipped++;
      }
    } else {
      console.error(`Failed ${student.email}:`, authErr.message);
      failed++;
    }
    continue;
  }

  // Link auth_id back to student row
  await supabase.from("students").update({ auth_id: authData.user.id }).eq("id", student.id);
  created++;

  if (created % 50 === 0) console.log(`Progress: ${created} created...`);
}

console.log(`\nDone. Created: ${created}, Linked existing: ${skipped}, Failed: ${failed}`);
console.log(`Students can now log in with: email + rollnumber@1234`);
