const express = require("express");
const { requireHost } = require("../middleware/auth");
const { createSession, listSessions, getSession, updateSession, deleteSession } = require("../controllers/session.controller");

const router = express.Router();

router.use(requireHost);
router.post("/", createSession);
router.get("/", listSessions);
router.get("/:id", getSession);
router.patch("/:id", updateSession);
router.delete("/:id", deleteSession);

module.exports = router;
