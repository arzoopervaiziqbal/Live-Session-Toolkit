const express = require("express");
const { requireHost } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const ctrl = require("../controllers/activity.controller");

const router = express.Router();
router.use(requireHost);

router.patch("/:id", asyncHandler(ctrl.updateActivity));
router.delete("/:id", asyncHandler(ctrl.deleteActivity));
router.post("/:id/unpublish", asyncHandler(ctrl.unpublishActivity));
router.post("/:id/push", asyncHandler(ctrl.pushActivity));
router.post("/:id/close", asyncHandler(ctrl.closeActivity));
router.post("/:id/end", asyncHandler(ctrl.endActivity));
router.get("/:id/results", asyncHandler(ctrl.getActivityResults));

module.exports = router;
