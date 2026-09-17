const express = require("express");
const { requireHost } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const upload = require("../middleware/upload");

const session = require("../controllers/session.controller");
const activity = require("../controllers/activity.controller");
const report = require("../controllers/report.controller");
const qa = require("../controllers/qa.controller");

const router = express.Router();

// ---- Q&A feed is readable and writable without a host token: participants
// ---- post here too. Declared before router.use(requireHost).
router.get("/:sessionId/qa", asyncHandler(qa.listQuestions));
router.post("/:sessionId/qa", asyncHandler(qa.postQuestion));

router.use(requireHost);

// Sessions
router.post("/", asyncHandler(session.createSession));
router.get("/", asyncHandler(session.listSessions));
router.get("/:id", asyncHandler(session.getSession));
router.patch("/:id", asyncHandler(session.updateSession));
router.delete("/:id", asyncHandler(session.deleteSession));

// Material + lifecycle
router.post("/:id/notes", upload.single("file"), asyncHandler(session.uploadNotes));
router.post("/:id/start", asyncHandler(session.startSession));
router.post("/:id/end", asyncHandler(session.endSession));
router.get("/:id/live", asyncHandler(session.getLiveState));
router.get("/:id/leaderboard", asyncHandler(session.getSessionLeaderboard));

// Activities scoped to a session
router.get("/:sessionId/activities", asyncHandler(activity.listActivities));
router.post("/:sessionId/activities", asyncHandler(activity.createActivity));
router.post("/:sessionId/activities/generate", asyncHandler(activity.generate));
router.post("/:sessionId/activities/publish", asyncHandler(activity.publishActivities));

// Reports
router.get("/:id/report", asyncHandler(report.getReport));
router.get("/:id/report/export", asyncHandler(report.exportReport));
router.get("/:id/report/export/pdf", asyncHandler(report.exportPdf));
router.get("/:id/report/export/excel", asyncHandler(report.exportExcel));
router.get("/:id/report/export/word", asyncHandler(report.exportWord));

module.exports = router;
