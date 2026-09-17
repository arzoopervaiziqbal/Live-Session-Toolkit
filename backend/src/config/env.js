require("dotenv").config();

function required(name, value) {
  if (!value) {
    console.warn(
      `[env] ${name} is not set. Features that depend on it will fail with a clear error at request time.`
    );
  }
  return value || "";
}

module.exports = {
  port: parseInt(process.env.PORT || "5000", 10),
  clientUrl: process.env.CLIENT_URL || "http://localhost:3000",

  jwtSecret: process.env.JWT_SECRET || "dev_secret_change_me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  supabaseUrl: required("SUPABASE_URL", process.env.SUPABASE_URL),
  supabaseServiceRoleKey: required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ),

  geminiApiKey: required("GEMINI_API_KEY", process.env.GEMINI_API_KEY),
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
};
