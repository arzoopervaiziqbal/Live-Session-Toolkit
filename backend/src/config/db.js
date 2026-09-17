const { createClient } = require("@supabase/supabase-js");
const env = require("./env");

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.warn(
    "[db] Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env"
  );
}

// Service-role client: bypasses RLS, so it must never be shipped to the browser.
// No session persistence / token refresh — this process is stateless.
const supabase = createClient(
  env.supabaseUrl || "http://localhost",
  env.supabaseServiceRoleKey || "missing-key",
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "live-session-toolkit" } },
  }
);

// Thin wrapper so callers get real Errors instead of { data, error } tuples.
// Usage:  const rows = await q(supabase.from("sessions").select("*"));
async function q(builder, context = "database query") {
  const { data, error } = await builder;
  if (error) {
    const err = new Error(`${context} failed: ${error.message}`);
    err.status = 500;
    err.code = error.code;
    err.details = error.details;
    throw err;
  }
  return data;
}

async function connectDB() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error(
      "Supabase is not configured. Copy backend/.env.example to backend/.env and fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  // Cheap round-trip that also proves the schema has been applied.
  const { error } = await supabase.from("hosts").select("id").limit(1);
  if (error) {
    throw new Error(
      `Could not reach Supabase or the schema is missing (${error.message}). ` +
        "Run backend/src/config/schema.sql in the Supabase SQL editor."
    );
  }
  console.log("[db] Connected to Supabase");
}

module.exports = { supabase, q, connectDB };
