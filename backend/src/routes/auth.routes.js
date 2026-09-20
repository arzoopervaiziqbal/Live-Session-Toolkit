const express = require("express");
const { hostAuth, participantAuth } = require("../controllers/auth.controller");
const { requireHost, requireParticipant } = require("../middleware/auth");

const router = express.Router();

router.post("/host/register", hostAuth.register);
router.post("/host/login", hostAuth.login);
router.get("/host/me", requireHost, hostAuth.me);

router.post("/participant/register", participantAuth.register);
router.post("/participant/login", participantAuth.login);
router.get("/participant/me", requireParticipant, participantAuth.me);

module.exports = router;
