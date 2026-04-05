const fs = require("fs");
const path = require("path");
const Product = require("../models/Product");
const {
  ensurePipelineVectors,
  searchVisual,
  upsertProductVector,
  deleteProductVector,
} = require("../services/visualSearchService");

function parseNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseRatingCount(value) {
  if (value === undefined || value === null || value === "") return 0;
  return parseNumber(String(value).replace(/,/g, ""), 0);
}

// ─────────────────────────────────────────────
//  GET /api/products
//  Public: list products with pagination & filters
// ─────────────────────────────────────────────
exports.getProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.category) {
      filter.main_category = new RegExp(req.query.category, "i");
    }
    if (req.query.sub_category) {
      filter.sub_category = new RegExp(req.query.sub_category, "i");
    }
    if (req.query.min_price || req.query.max_price) {
      filter.discount_price_usd = {};
      if (req.query.min_price) filter.discount_price_usd.$gte = Number(req.query.min_price);
      if (req.query.max_price) filter.discount_price_usd.$lte = Number(req.query.max_price);
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
      return res.status(400).json({ message: "Please provide a search query (?q=...)" });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
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
//  POST /api/products/search/visual
//  Public: visual similarity search using DINO + Qdrant
// ─────────────────────────────────────────────
exports.searchProductsByImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please upload an image file (field: image)." });
    }

    const topK = Math.max(1, Math.min(Number(req.body.top_k || req.query.top_k || 12), 30));
    const searchResult = await searchVisual(req.file.path, topK);
    const hits = Array.isArray(searchResult.hits) ? searchResult.hits : [];
    const idCandidates = hits
      .map((hit) => String(hit?.payload?.product_id || "").trim())
      .filter(Boolean);
    const linkCandidates = hits
      .map((hit) => String(hit?.payload?.link || "").trim())
      .filter(Boolean);

    const [productsByIdRows, productsByLinkRows] = await Promise.all([
      idCandidates.length ? Product.find({ _id: { $in: idCandidates } }) : Promise.resolve([]),
      linkCandidates.length ? Product.find({ link: { $in: linkCandidates } }) : Promise.resolve([]),
    ]);
    const productsById = new Map(productsByIdRows.map((row) => [String(row._id), row]));
    const productsByLink = new Map(productsByLinkRows.map((row) => [row.link, row]));

    const products = [];
    for (const hit of hits) {
      const payload = hit.payload || {};
      const productId = payload.product_id ? String(payload.product_id) : "";
      const productLink = payload.link ? String(payload.link) : "";
      let product = null;
      if (productId && productsById.has(productId)) {
        product = productsById.get(productId);
      } else if (productLink && productsByLink.has(productLink)) {
        product = productsByLink.get(productLink);
      }
      if (product) {
        products.push({
          ...product.toObject(),
          visual_score: hit.score,
        });
      } else {
        products.push({
          _id: payload.product_id || `visual-${hit.id}`,
          name: payload.name || "Visual match",
          main_category: payload.main_category || "",
          sub_category: payload.sub_category || "",
          image_url: "",
          image_local: payload.image_local || "",
          link: payload.link || "",
          ratings: 0,
          no_of_ratings: 0,
          description: "",
          discount_price_usd: 0,
          actual_price_usd: 0,
          visual_score: hit.score,
        });
      }
    }

    res.json({
      products,
      totalProducts: products.length,
      totalPages: 1,
      page: 1,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  } finally {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
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
//  Admin only: add product with image upload
// ─────────────────────────────────────────────
exports.createProduct = async (req, res) => {
  let product = null;
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ message: "Product image is required. Upload an image in field: image." });
    }

    const imageUrlPath = `/uploads/products/${path.basename(req.file.path)}`;
    product = await Product.create({
      name: req.body.name,
      main_category: req.body.main_category,
      sub_category: req.body.sub_category || "",
      image_url: imageUrlPath,
      image_local: req.file.path,
      link: req.body.link || "",
      ratings: parseNumber(req.body.ratings, 0),
      no_of_ratings: parseRatingCount(req.body.no_of_ratings),
      description: req.body.description || "",
      discount_price_usd: parseNumber(req.body.discount_price_usd, 0),
      actual_price_usd: parseNumber(req.body.actual_price_usd, 0),
    });

    await upsertProductVector(product, req.file.path);
    res.status(201).json({ product });
  } catch (error) {
    if (product?._id) {
      await Product.findByIdAndDelete(product._id);
    }
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  POST /api/products/search/visual/sync
//  Admin only: sync pipeline1 embeddings to local Qdrant
// ─────────────────────────────────────────────
exports.syncVisualVectors = async (_req, res) => {
  try {
    const syncResult = await ensurePipelineVectors();
    res.json({ message: "Visual vectors ready", ...syncResult });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  PUT /api/products/:id
//  Admin only: update product
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
//  Admin only: delete product
// ─────────────────────────────────────────────
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await deleteProductVector(req.params.id);
    if (product.image_local && product.image_local.includes("/uploads/products/")) {
      fs.unlink(product.image_local, () => {});
    }
    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
