const bcrypt = require("bcryptjs");
const HostUser = require("../models/HostUser");
const ParticipantUser = require("../models/ParticipantUser");
const { signToken } = require("../utils/jwt");
const { validateRegister, validateLogin } = require("../utils/validators");

const SALT_ROUNDS = 10;

function makeAuthControllers(Model, role) {
  async function register(req, res) {
    const { name, email, password, confirmPassword } = req.body;
    const errors = validateRegister({ name, email, password, confirmPassword });
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ errors });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await Model.findOne({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(400).json({ errors: { email: "An account with this email already exists." } });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await Model.create({ name: name.trim(), email: normalizedEmail, passwordHash });

    const token = signToken({ id: user._id, name: user.name, email: user.email, role });
    return res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role } });
  }

  async function login(req, res) {
    const { email, password } = req.body;
    const errors = validateLogin({ email, password });
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ errors });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await Model.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ errors: { form: "Email or password is incorrect." } });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ errors: { form: "Email or password is incorrect." } });
    }

    const token = signToken({ id: user._id, name: user.name, email: user.email, role });
    return res.json({ token, user: { id: user._id, name: user.name, email: user.email, role } });
  }

  async function me(req, res) {
    const user = await Model.findByPk(req.user.id, { attributes: { exclude: ["passwordHash"] } });
    if (!user) return res.status(404).json({ error: "User not found." });
    return res.json({ user: { id: user._id, name: user.name, email: user.email, role } });
  }

  return { register, login, me };
}

const hostAuth = makeAuthControllers(HostUser, "host");
const participantAuth = makeAuthControllers(ParticipantUser, "participant");

module.exports = { hostAuth, participantAuth };
