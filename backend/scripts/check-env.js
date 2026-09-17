// Quick preflight: `npm run check` tells you exactly what's missing before you
// waste time debugging a runtime error.
require("dotenv").config();

const checks = [
  ["SUPABASE_URL", process.env.SUPABASE_URL, "Supabase -> Project Settings -> API -> Project URL"],
  ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY, "Supabase -> Project Settings -> API -> service_role key"],
  ["GEMINI_API_KEY", process.env.GEMINI_API_KEY, "https://aistudio.google.com/apikey"],
  ["JWT_SECRET", process.env.JWT_SECRET, "Any long random string"],
];

let failed = 0;
for (const [name, value, hint] of checks) {
  const placeholder = !value || /your_|change_this|your-project-ref/.test(value);
  if (placeholder) {
    console.log(`  MISSING  ${name.padEnd(28)} -> ${hint}`);
    failed++;
  } else {
    console.log(`  ok       ${name}`);
  }
}

if (failed) {
  console.log(`\n${failed} value(s) still need filling in backend/.env\n`);
  process.exit(1);
}
console.log("\nAll set. Run the schema in Supabase, then `npm run dev`.\n");
