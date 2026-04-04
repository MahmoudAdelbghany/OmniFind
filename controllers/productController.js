const Product = require("../models/Product");

// ─────────────────────────────────────────────
//  GET /api/products
//  Public: list products with pagination & filters
// ─────────────────────────────────────────────
exports.getProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};

    if (req.query.category) {
      filter.main_category = new RegExp(req.query.category, "i");
    }
    if (req.query.sub_category) {
      filter.sub_category = new RegExp(req.query.sub_category, "i");
    }
    if (req.query.min_price || req.query.max_price) {
      filter.discount_price_usd = {};
      if (req.query.min_price)
        filter.discount_price_usd.$gte = Number(req.query.min_price);
      if (req.query.max_price)
        filter.discount_price_usd.$lte = Number(req.query.max_price);
    }
    if (req.query.min_rating) {
      filter.ratings = { $gte: Number(req.query.min_rating) };
    }

    const [products, total] = await Promise.all([
      Product.find(filter).skip(skip).limit(limit).sort({ ratings: -1 }),
      Product.countDocuments(filter),
    ]);

    res.json({
      products,
      page,
      totalPages: Math.ceil(total / limit),
      totalProducts: total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  GET /api/products/:id
//  Public: get single product
// ─────────────────────────────────────────────
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json({ product });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  GET /api/products/search/text?q=...
//  Public: full-text search using MongoDB text index
// ─────────────────────────────────────────────
exports.searchProducts = async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res
        .status(400)
        .json({ message: "Please provide a search query (?q=...)" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const products = await Product.find(
      { $text: { $search: query } },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limit);

    const total = await Product.countDocuments({ $text: { $search: query } });

    res.json({
      products,
      page,
      totalPages: Math.ceil(total / limit),
      totalProducts: total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  GET /api/products/categories/list
//  Public: get all unique categories
// ─────────────────────────────────────────────
exports.getCategories = async (req, res) => {
  try {
    const categories = await Product.distinct("main_category");
    res.json({ categories });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  POST /api/products
//  Admin only: add a new product
// ─────────────────────────────────────────────
exports.createProduct = async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json({ product });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  PUT /api/products/:id
//  Admin only: update a product
// ─────────────────────────────────────────────
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json({ product });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  DELETE /api/products/:id
//  Admin only: delete a product
// ─────────────────────────────────────────────
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
