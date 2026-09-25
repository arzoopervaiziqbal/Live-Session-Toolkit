const express = require("express");
const { requireHost } = require("../middleware/auth");
const upload = require("../middleware/upload");
const ctrl = require("../controllers/activity.controller");

const router = express.Router();

router.use(requireHost);
router.post("/sessions/:sessionId/activities", ctrl.createActivity);
router.post("/activities/:id/upload-notes", upload.single("file"), ctrl.uploadNotes);
router.patch("/activities/:id", ctrl.updateActivity);
router.post("/activities/:id/generate", ctrl.generate);
router.post("/activities/:id/questions", ctrl.addQuestion);
router.patch("/activities/:id/questions/:qId", ctrl.updateQuestion);
router.delete("/activities/:id/questions/:qId", ctrl.removeQuestion);
router.post("/activities/:id/publish", ctrl.publish);
router.post("/activities/:id/close", ctrl.closeActivity);
router.get("/activities/:id/results", ctrl.getResults);
router.get("/activities/:id/export", ctrl.exportCsv);
router.patch("/activities/:id/qa/:questionId", ctrl.answerQa);
router.delete("/activities/:id/qa/:questionId", ctrl.deleteQa);
router.patch("/activities/:id/toggle-qa", ctrl.toggleQa);
router.post("/activities/:id/proctor-decision", ctrl.decideProctorViolation);

module.exports = router;
