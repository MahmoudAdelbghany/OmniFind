const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/auth");
const {
  getFavorites,
  addFavorite,
  removeFavorite,
} = require("../controllers/favoriteController");

// ── All favorite routes require login + "user" or "admin" role ──
router.use(protect, authorize("user", "admin"));

router.get("/", getFavorites);
router.post("/", addFavorite);
router.delete("/:productId", removeFavorite);

module.exports = router;
