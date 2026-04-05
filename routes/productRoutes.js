const express = require("express");
const router = express.Router();
const { protect, authorize, allowGuest } = require("../middleware/auth");
const { uploadProductImage } = require("../middleware/upload");
const {
  getProducts,
  getProduct,
  searchProducts,
  getCategories,
  createProduct,
  searchProductsByImage,
  syncVisualVectors,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

// ── Public routes (guests can access) ──
router.get("/", allowGuest, getProducts);
router.get("/search/text", allowGuest, searchProducts);
router.post("/search/visual", allowGuest, uploadProductImage.single("image"), searchProductsByImage);
router.get("/categories/list", allowGuest, getCategories);
router.get("/:id", allowGuest, getProduct);

// ── Admin-only routes ──
router.post("/", protect, authorize("admin"), uploadProductImage.single("image"), createProduct);
router.post("/search/visual/sync", protect, authorize("admin"), syncVisualVectors);
router.put("/:id", protect, authorize("admin"), updateProduct);
router.delete("/:id", protect, authorize("admin"), deleteProduct);

module.exports = router;
