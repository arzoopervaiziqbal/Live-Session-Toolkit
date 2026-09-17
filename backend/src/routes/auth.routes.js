const express = require("express");
const { requireHost } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const ctrl = require("../controllers/auth.controller");

const router = express.Router();

router.post("/host/register", asyncHandler(ctrl.register));
router.post("/host/login", asyncHandler(ctrl.login));
router.get("/host/me", requireHost, asyncHandler(ctrl.me));

module.exports = router;
