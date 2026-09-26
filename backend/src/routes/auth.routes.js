const express = require("express");
const { hostAuth, participantAuth } = require("../controllers/auth.controller");
const { requireHost, requireParticipant } = require("../middleware/auth");

const router = express.Router();

// Host Auth
router.post("/host/register", hostAuth.register);
router.post("/host/login", hostAuth.login);
router.post("/host/google", hostAuth.google);
router.post("/host/phone/send-otp", hostAuth.phoneSendOtp);
router.post("/host/phone/verify-otp", hostAuth.phoneVerifyOtp);
router.get("/host/me", requireHost, hostAuth.me);

// Participant Auth
router.post("/participant/register", participantAuth.register);
router.post("/participant/login", participantAuth.login);
router.post("/participant/google", participantAuth.google);
router.post("/participant/phone/send-otp", participantAuth.phoneSendOtp);
router.post("/participant/phone/verify-otp", participantAuth.phoneVerifyOtp);
router.get("/participant/me", requireParticipant, participantAuth.me);

module.exports = router;

