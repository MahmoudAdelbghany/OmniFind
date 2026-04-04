const Favorite = require("../models/Favorite");

// ─────────────────────────────────────────────
//  GET /api/favorites
//  Get all favorites for the logged-in user
// ─────────────────────────────────────────────
exports.getFavorites = async (req, res) => {
  try {
    const favorites = await Favorite.find({ user: req.user._id })
      .populate("product")
      .sort({ createdAt: -1 });

    res.json({ favorites });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  POST /api/favorites
//  Add a product to favorites
//  Body: { productId: "..." }
// ─────────────────────────────────────────────
exports.addFavorite = async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ message: "productId is required" });
    }

    // Check if already favorited
    const existing = await Favorite.findOne({
      user: req.user._id,
      product: productId,
    });
    if (existing) {
      return res.status(400).json({ message: "Product already in favorites" });
    }

    const favorite = await Favorite.create({
      user: req.user._id,
      product: productId,
    });
    const populated = await favorite.populate("product");

    res.status(201).json({ favorite: populated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Product already in favorites" });
    }
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  DELETE /api/favorites/:productId
//  Remove a product from favorites
// ─────────────────────────────────────────────
exports.removeFavorite = async (req, res) => {
  try {
    const favorite = await Favorite.findOneAndDelete({
      user: req.user._id,
      product: req.params.productId,
    });

    if (!favorite) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    res.json({ message: "Removed from favorites" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
