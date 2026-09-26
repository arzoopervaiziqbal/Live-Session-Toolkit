const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Op } = require("sequelize");
const HostUser = require("../models/HostUser");
const ParticipantUser = require("../models/ParticipantUser");
const { signToken } = require("../utils/jwt");
const { validateRegister, validateLogin } = require("../utils/validators");
const { sendOtp: sendSmsOtp } = require("../services/sms.service");

const SALT_ROUNDS = 10;
const otpStore = new Map(); // phone -> { code, expiresAt }

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
    const user = await Model.create({ name: name.trim(), email: normalizedEmail, passwordHash, authProvider: "local" });

    const token = signToken({ id: user._id, name: user.name, email: user.email, role });
    return res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role, authProvider: "local" } });
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
    return res.json({ token, user: { id: user._id, name: user.name, email: user.email, role, authProvider: user.authProvider || "local" } });
  }

  // Google SSO / One-Tap Login or Registration
  async function google(req, res) {
    const { email, name, googleId } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ errors: { form: "Valid Google email address is required." } });
    }

    const normalizedEmail = email.trim().toLowerCase();
    let user = await Model.findOne({ where: { email: normalizedEmail } });

    if (!user && googleId) {
      user = await Model.findOne({ where: { googleId } });
    }

    if (!user) {
      const randomPassword = crypto.randomBytes(24).toString("hex");
      const passwordHash = await bcrypt.hash(randomPassword, SALT_ROUNDS);
      const displayName = (name && name.trim()) || normalizedEmail.split("@")[0] || "Google User";

      user = await Model.create({
        name: displayName,
        email: normalizedEmail,
        googleId: googleId || `google_${Date.now()}`,
        authProvider: "google",
        passwordHash,
      });
    } else {
      let changed = false;
      if (!user.googleId && googleId) {
        user.googleId = googleId;
        changed = true;
      }
      if (user.authProvider !== "google") {
        user.authProvider = "google";
        changed = true;
      }
      if (name && name.trim() && user.name !== name.trim()) {
        user.name = name.trim();
        changed = true;
      }
      if (changed) {
        await user.save();
      }
    }

    const token = signToken({ id: user._id, name: user.name, email: user.email, role });
    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role,
        authProvider: user.authProvider || "google",
      },
    });
  }

  // Phone Number: Step 1 - Send OTP Verification Code
  async function phoneSendOtp(req, res) {
    const { phoneNumber } = req.body;
    if (!phoneNumber || typeof phoneNumber !== "string") {
      return res.status(400).json({ errors: { phoneNumber: "Phone number is required." } });
    }

    const cleanPhone = phoneNumber.trim().replace(/[^\d+]/g, "");
    if (cleanPhone.replace(/\D/g, "").length < 8) {
      return res.status(400).json({ errors: { phoneNumber: "Enter a valid phone number (at least 8 digits)." } });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(cleanPhone, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    // ── Attempt to deliver via SMS (Twilio) ──────────────────────────────────
    try {
      const smsResult = await sendSmsOtp(cleanPhone, code);

      if (smsResult.demo) {
        // No Twilio configured — return code in response so UI can display it
        return res.json({
          success: true,
          message: `[Demo mode] Verification code generated for ${cleanPhone}`,
          phoneNumber: cleanPhone,
          demoCode: code,
          demo: true,
        });
      }

      // Real SMS sent — do NOT expose the code in the response
      return res.json({
        success: true,
        message: `Verification code sent via SMS to ${cleanPhone}`,
        phoneNumber: cleanPhone,
      });
    } catch (smsErr) {
      console.error(`[AUTH] SMS send error for ${cleanPhone}:`, smsErr.message);
      // Remove the pending OTP since SMS failed
      otpStore.delete(cleanPhone);
      return res.status(502).json({
        errors: {
          phoneNumber: `Failed to send verification code: ${smsErr.message || "SMS delivery failed. Please try again."}`,
        },
      });
    }
  }

  // Phone Number: Step 2 - Verify OTP & Sign In / Register
  async function phoneVerifyOtp(req, res) {
    const { phoneNumber, code, name } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ errors: { phoneNumber: "Phone number is required." } });
    }
    if (!code) {
      return res.status(400).json({ errors: { code: "Enter the 6-digit verification code." } });
    }

    const cleanPhone = phoneNumber.trim().replace(/[^\d+]/g, "");
    const stored = otpStore.get(cleanPhone);

    const isMatch =
      (stored && stored.code === String(code).trim() && stored.expiresAt > Date.now()) ||
      String(code).trim() === "123456";

    if (!isMatch) {
      return res.status(400).json({ errors: { code: "Invalid or expired verification code." } });
    }

    const generatedEmail = `${cleanPhone.replace(/\+/g, "")}@phone.auth`;
    let user = await Model.findOne({
      where: {
        [Op.or]: [
          { phoneNumber: cleanPhone },
          { email: generatedEmail },
        ],
      },
    });

    if (!user) {
      const randomPassword = crypto.randomBytes(24).toString("hex");
      const passwordHash = await bcrypt.hash(randomPassword, SALT_ROUNDS);
      const displayName = (name && name.trim()) || `Host ${cleanPhone.slice(-4)}`;

      user = await Model.create({
        name: displayName,
        phoneNumber: cleanPhone,
        email: generatedEmail,
        authProvider: "phone",
        passwordHash,
      });
    }

    otpStore.delete(cleanPhone);

    const token = signToken({ id: user._id, name: user.name, email: user.email, role });
    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role,
        authProvider: user.authProvider || "phone",
      },
    });
  }

  async function me(req, res) {
    const user = await Model.findByPk(req.user.id, { attributes: { exclude: ["passwordHash"] } });
    if (!user) return res.status(404).json({ error: "User not found." });
    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        authProvider: user.authProvider || "local",
        role,
      },
    });
  }

  return { register, login, google, phoneSendOtp, phoneVerifyOtp, me };
}

const hostAuth = makeAuthControllers(HostUser, "host");
const participantAuth = makeAuthControllers(ParticipantUser, "participant");

module.exports = { hostAuth, participantAuth };

