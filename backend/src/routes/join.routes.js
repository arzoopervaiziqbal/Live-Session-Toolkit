const express = require("express");
const { getActivityByCode, submitResponses } = require("../controllers/join.controller");

const router = express.Router();

router.get("/:linkId", getActivityByCode);
router.post("/:linkId/submit", submitResponses);

module.exports = router;
