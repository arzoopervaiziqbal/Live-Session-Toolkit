const crypto = require("crypto");
const { supabase, q } = require("../config/db");

// No 0/O/1/I/L — these are the characters people misread when a code is
// projected on a screen and typed into a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function randomCode(length = CODE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Generates a code that isn't already taken by another session. */
async function generateUniqueSessionCode(attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const code = randomCode();
    const existing = await q(
      supabase.from("sessions").select("id").eq("session_code", code).maybeSingle(),
      "check session code"
    );
    if (!existing) return code;
  }
  // Astronomically unlikely; widen the space rather than fail the request.
  return randomCode(CODE_LENGTH + 2);
}

/**
 * Accepts anything a participant might paste: a bare code, a full join URL,
 * or a URL with ?code= on it.
 */
function normaliseCode(raw) {
  if (!raw || typeof raw !== "string") return "";
  let str = raw.trim();

  if (str.includes("code=")) {
    const match = str.match(/code=([^&\s]+)/);
    if (match) str = match[1];
  } else if (str.includes("/")) {
    const parts = str.split("?")[0].split("/").filter(Boolean);
    str = parts[parts.length - 1] || "";
  }

  return str.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

module.exports = { generateUniqueSessionCode, normaliseCode, randomCode };
