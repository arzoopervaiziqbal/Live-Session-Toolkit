const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const ctrl = require("../controllers/join.controller");

const router = express.Router();

// All public — participants never hold an account (PRD 4: join via link or code).
router.post("/", asyncHandler(ctrl.joinSession));
router.get("/:code", asyncHandler(ctrl.lookupSession));
router.get("/:sessionId/me", asyncHandler(ctrl.getParticipantState));
router.post("/:sessionId/responses", asyncHandler(ctrl.submitResponse));
router.post("/:sessionId/responses/batch", asyncHandler(ctrl.submitBatch));

module.exports = router;
