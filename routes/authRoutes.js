const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  register,
  login,
  guestLogin,
  getMe,
  createAdmin,
} = require("../controllers/authController");

// ── Public routes ──
router.post("/register", register);
router.post("/login", login);
router.post("/guest", guestLogin);

// ── Protected routes (any logged-in user) ──
router.get("/me", protect, getMe);

// ── Admin-only routes ──
router.post("/create-admin", protect, authorize("admin"), createAdmin);

module.exports = router;
