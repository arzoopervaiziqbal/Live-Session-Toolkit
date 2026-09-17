const bcrypt = require("bcryptjs");
const { supabase, q } = require("../config/db");
const { signToken } = require("../utils/jwt");
const { validateRegister, validateLogin } = require("../utils/validators");
const { httpError } = require("../middleware/error");

const SALT_ROUNDS = 10;

function publicUser(host) {
  return { id: host.id, name: host.name, email: host.email, role: "host" };
}

async function register(req, res) {
  const { name, email, password, confirmPassword } = req.body;
  const errors = validateRegister({ name, email, password, confirmPassword });
  if (Object.keys(errors).length) throw httpError(400, "Please fix the highlighted fields.", errors);

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await q(
    supabase.from("hosts").select("id").eq("email", normalizedEmail).maybeSingle(),
    "check existing host"
  );
  if (existing) {
    throw httpError(400, "An account with this email already exists.", {
      email: "An account with this email already exists.",
    });
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const host = await q(
    supabase
      .from("hosts")
      .insert({ name: name.trim(), email: normalizedEmail, password_hash })
      .select("id, name, email")
      .single(),
    "create host"
  );

  const user = publicUser(host);
  res.status(201).json({ token: signToken(user), user });
}

async function login(req, res) {
  const { email, password } = req.body;
  const errors = validateLogin({ email, password });
  if (Object.keys(errors).length) throw httpError(400, "Please fix the highlighted fields.", errors);

  const normalizedEmail = email.trim().toLowerCase();
  const host = await q(
    supabase
      .from("hosts")
      .select("id, name, email, password_hash")
      .eq("email", normalizedEmail)
      .maybeSingle(),
    "find host"
  );

  // Same message and roughly the same work either way, so the response can't
  // be used to enumerate which emails have accounts.
  const hash = host ? host.password_hash : "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin";
  const match = await bcrypt.compare(password, hash);

  if (!host || !match) {
    throw httpError(401, "Email or password is incorrect.", {
      form: "Email or password is incorrect.",
    });
  }

  const user = publicUser(host);
  res.json({ token: signToken(user), user });
}

async function me(req, res) {
  const host = await q(
    supabase.from("hosts").select("id, name, email").eq("id", req.user.id).maybeSingle(),
    "load host"
  );
  if (!host) throw httpError(404, "Account not found.");
  res.json({ user: publicUser(host) });
}

module.exports = { register, login, me };
