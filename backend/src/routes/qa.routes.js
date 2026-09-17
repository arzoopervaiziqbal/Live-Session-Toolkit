const express = require("express");
const { requireHost } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const ctrl = require("../controllers/qa.controller");

const router = express.Router();
router.use(requireHost);

router.patch("/:id", asyncHandler(ctrl.updateQuestion));
router.delete("/:id", asyncHandler(ctrl.deleteQuestion));

module.exports = router;
