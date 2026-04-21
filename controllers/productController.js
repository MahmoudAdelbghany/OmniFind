const fs = require("fs");
const path = require("path");
const Product = require("../models/Product");
const {
  ensurePipelineVectors,
  searchVisual,
  upsertProductVector,
  deleteProductVector,
  ensureTextVectors,
  searchText,
  upsertProductTextVector,
  deleteProductTextVector,
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

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ── Text search state ──
let textIndexReady = false;
let textIndexInitPromise = null;
let textIndexedCount = null;

async function ensureTextSearchReady(force = false) {
  if (!force && textIndexReady) {
    const currentCount = await Product.countDocuments({});
    if (textIndexedCount === currentCount) {
      return { synced: false, reason: "already-ready", count: currentCount };
    }
  }
  if (!force && textIndexInitPromise) {
    return textIndexInitPromise;
  }

  textIndexInitPromise = (async () => {
    const products = await Product.find(
      {},
      {
        _id: 1,
        name: 1,
        main_category: 1,
        sub_category: 1,
        description: 1,
        discount_price_usd: 1,
        actual_price_usd: 1,
        ratings: 1,
        no_of_ratings: 1,
        link: 1,
        image_local: 1,
        image_url: 1,
      },
    ).lean();

    const syncResult = await ensureTextVectors(products, { force });
    textIndexReady = true;
    textIndexedCount = products.length;
    return syncResult;
  })();

  try {
    return await textIndexInitPromise;
  } catch (error) {
    textIndexReady = false;
    textIndexedCount = null;
    throw error;
  } finally {
    textIndexInitPromise = null;
  }
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
//  Public: hybrid semantic search powered by
//  BGE-M3 + Qdrant (OmniFind V2 pipeline)
// ─────────────────────────────────────────────
exports.searchProducts = async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ message: "Please provide a search query (?q=...)" });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 50));

    // Lazily initialize text index on first search
    await ensureTextSearchReady(false);

    const requestedPool = Math.max(limit * page, parseInt(req.query.search_pool, 10) || 240);
    const topK = Math.min(requestedPool, 1000);

    const searchOptions = {
      topK,
      category: req.query.category,
      subCategory: req.query.sub_category,
      minPrice: parseOptionalNumber(req.query.min_price),
      maxPrice: parseOptionalNumber(req.query.max_price),
      minRating: parseOptionalNumber(req.query.min_rating),
    };

    let searchResult;
    try {
      searchResult = await searchText(query, searchOptions);
    } catch (firstError) {
      const message = String(firstError?.message || "");
      const shouldRecover =
        message.includes("Collection") ||
        message.includes("Wrong input") ||
        message.includes("expected dim") ||
        message.includes("not found") ||
        message.includes("No text encoder backend");

      if (!shouldRecover) {
        throw firstError;
      }

      // Recovery path: rebuild text index and retry once.
      await ensureTextSearchReady(true);
      searchResult = await searchText(query, searchOptions);
    }

    // Resolve hits to full MongoDB product documents
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

    const rankedProducts = [];
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
        rankedProducts.push({
          ...product.toObject(),
          text_score: hit.score,
        });
      } else {
        rankedProducts.push({
          _id: payload.product_id || `text-${hit.id}`,
          name: payload.name || "Search match",
          main_category: payload.main_category || "",
          sub_category: payload.sub_category || "",
          image_url: payload.image_url || "",
          image_local: payload.image_local || "",
          link: payload.link || "",
          ratings: parseNumber(payload.ratings, 0),
          no_of_ratings: parseRatingCount(payload.no_of_ratings),
          description: payload.description || "",
          discount_price_usd: parseNumber(payload.discount_price_usd, 0),
          actual_price_usd: parseNumber(payload.actual_price_usd, 0),
          text_score: hit.score,
        });
      }
    }

    const total = rankedProducts.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const pagedProducts = rankedProducts.slice(start, start + limit);

    res.json({
      products: pagedProducts,
      page: safePage,
      totalPages,
      totalProducts: total,
      intent: searchResult.intent || null,
      searchEngine: {
        provider: "qdrant",
        collection: searchResult.collection || "",
        encoder: searchResult.encoder || "",
      },
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
          image_url: payload.image_url || "",
          image_local: payload.image_local || "",
          link: payload.link || "",
          ratings: parseNumber(payload.ratings, 0),
          no_of_ratings: parseRatingCount(payload.no_of_ratings),
          description: payload.description || "",
          discount_price_usd: parseNumber(payload.discount_price_usd, 0),
          actual_price_usd: parseNumber(payload.actual_price_usd, 0),
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

    // Index in both visual and text collections
    await Promise.all([
      upsertProductVector(product, req.file.path),
      upsertProductTextVector(product),
    ]);
    if (typeof textIndexedCount === "number") {
      textIndexedCount += 1;
    }

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
//  POST /api/products/search/text/sync
//  Admin only: sync text embeddings to Qdrant text collection
// ─────────────────────────────────────────────
exports.syncTextVectors = async (_req, res) => {
  try {
    const syncResult = await ensureTextSearchReady(true);
    res.json({ message: "Text vectors ready", ...syncResult });
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

    // Re-index text vectors for the updated product
    await upsertProductTextVector(product);

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

    // Remove from both visual and text collections
    await Promise.allSettled([
      deleteProductVector(req.params.id),
      deleteProductTextVector(req.params.id),
    ]);
    if (typeof textIndexedCount === "number") {
      textIndexedCount = Math.max(0, textIndexedCount - 1);
    }

    if (product.image_local && product.image_local.includes("/uploads/products/")) {
      fs.unlink(product.image_local, () => {});
    }

    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  POST /api/products/search/voice
//  Public: speech-to-text then hybrid semantic search
// ─────────────────────────────────────────────
exports.searchProductsVoice = async (req, res) => {
  try {
    const { transcribeAudio } = require("../services/localSttService");
    if (!req.file?.path) {
      return res.status(400).json({ message: "Please upload an audio file (field: audio)." });
    }

    const sttResult = await transcribeAudio(req.file.path);
    const transcript = String(sttResult?.transcript || "").trim();
    if (!transcript) {
      return res.status(400).json({ message: "No speech detected. Please try again." });
    }

    const page = Math.max(1, parseInt(req.body.page || req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.body.limit || req.query.limit, 10) || 20, 40));

    // Warmup text index if needed
    await ensureTextSearchReady(false);

    const searchOptions = {
      topK: Math.max(limit * page * 2, 80),
      category: req.body.category || req.query.category,
      minPrice: parseOptionalNumber(req.body.min_price || req.query.min_price),
      maxPrice: parseOptionalNumber(req.body.max_price || req.query.max_price),
      minRating: parseOptionalNumber(req.body.min_rating || req.query.min_rating),
    };

    const searchResult = await searchText(transcript, searchOptions);
    const hits = Array.isArray(searchResult.hits) ? searchResult.hits : [];

    // Map hits to products (shared logic could be moved to a helper, but for now we'll match searchProducts behavior)
    const idCandidates = hits.map(h => String(h?.payload?.product_id || "")).filter(Boolean);
    const productsByIdRows = idCandidates.length ? await Product.find({ _id: { $in: idCandidates } }) : [];
    const productsById = new Map(productsByIdRows.map(row => [String(row._id), row]));

    const products = hits.map(hit => {
      const payload = hit.payload || {};
      const product = productsById.get(String(payload.product_id));
      if (product) {
        return { ...product.toObject(), text_score: hit.score };
      }
      return {
        _id: payload.product_id || `voice-${hit.id}`,
        name: payload.name || "Voice match",
        main_category: payload.main_category || "",
        image_local: payload.image_local || "",
        text_score: hit.score
      };
    }).slice(0, limit);

    res.json({
      transcript,
      stt_provider: sttResult?.provider || "local-faster-whisper",
      products,
      page,
      totalPages: 1,
      totalProducts: products.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  } finally {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
  }
};

exports.searchProductsSemantic = exports.searchProducts;
exports.warmupTextIndex = async () => ensureTextSearchReady(false);

