const express = require("express");
const {
  getActivityByCode,
  submitResponses,
  postParticipantQuestion,
  reportProctorAlert,
} = require("../controllers/join.controller");

const router = express.Router();

router.get("/:linkId", getActivityByCode);
router.post("/:linkId/submit", submitResponses);
router.post("/:linkId/qa", postParticipantQuestion);
router.post("/:linkId/proctor-alert", reportProctorAlert);

module.exports = router;

