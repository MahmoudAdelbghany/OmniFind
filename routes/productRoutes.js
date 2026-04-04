const express = require("express");
const router = express.Router();
const { protect, authorize, allowGuest } = require("../middleware/auth");
const {
  getProducts,
  getProduct,
  searchProducts,
  getCategories,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

// ── Public routes (guests can access) ──
router.get("/", allowGuest, getProducts);
router.get("/search/text", allowGuest, searchProducts);
router.get("/categories/list", allowGuest, getCategories);
router.get("/:id", allowGuest, getProduct);

// ── Admin-only routes ──
router.post("/", protect, authorize("admin"), createProduct);
router.put("/:id", protect, authorize("admin"), updateProduct);
router.delete("/:id", protect, authorize("admin"), deleteProduct);

module.exports = router;
