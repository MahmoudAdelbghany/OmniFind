require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const connectDB = require("./config/db");
const { ensurePipelineVectors } = require("./services/visualSearchService");
const { seedCatalog } = require("./services/catalogBootstrapService");
const { requestProfiling, captureErrorForProfiling } = require("./middleware/requestProfiling");

// ── Import routes ──
const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const favoriteRoutes = require("./routes/favoriteRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");

// ── Create Express app ──
const app = express();

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(requestProfiling);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
const amzonBaseDir = process.env.AMZON_BASE_DIR || "/home/abghany/amzon";
app.use(
  "/amzon-images",
  express.static(path.join(amzonBaseDir, "final_data", "visual_dataset", "images")),
);
app.use(
  "/product-images",
  express.static(path.join(__dirname, "data", "product_images")),
);

// ── Routes ──
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/chatbot", chatbotRoutes);

// ── Health check ──
app.get("/api/health", (req, res) => {
  res.json({ message: "OmniFind API is running", version: "1.0.0" });
});

const frontendDistDir = path.join(__dirname, "frontend", "dist");
const frontendIndexPath = path.join(frontendDistDir, "index.html");
const hasFrontendBuild = fs.existsSync(frontendIndexPath);
if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/uploads/") ||
      req.path.startsWith("/amzon-images/") ||
      req.path.startsWith("/product-images/")
    ) {
      return next();
    }
    return res.sendFile(frontendIndexPath);
  });
}

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

// ── Error handler ──
app.use(captureErrorForProfiling);
app.use((err, req, res, next) => {
  if (err?.name === "MulterError") {
    return res.status(400).json({ message: err.message });
  }
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error" });
});

// ── Start server ──
const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  const seedResult = await seedCatalog();
  if (seedResult.seeded) {
    console.log(`Seeded ${seedResult.count} products into catalog.`);
  }
  ensurePipelineVectors().catch((error) => {
    console.warn(`Visual worker warmup failed: ${error.message}`);
  });
  app.listen(PORT, () => {
    console.log(`\n  OmniFind API running on http://localhost:${PORT}`);
    console.log(`  ─────────────────────────────────────────────`);
    console.log(`  Routes:`);
    console.log(`    POST   /api/auth/register`);
    console.log(`    POST   /api/auth/login`);
    console.log(`    POST   /api/auth/guest`);
    console.log(`    GET    /api/auth/me`);
    console.log(`    POST   /api/auth/create-admin   (admin only)`);
    console.log(`    GET    /api/products`);
    console.log(`    GET    /api/products/search/text?q=...`);
    console.log(`    GET    /api/products/search/semantic?q=...`);
    console.log(`    POST   /api/products/search/voice    (multipart audio upload)`);
    console.log(`    POST   /api/products/search/visual   (multipart image upload)`);
    console.log(`    POST   /api/products/search/visual/sync   (admin only)`);
    console.log(`    POST   /api/products/search/text/sync     (admin only)`);
    console.log(`    GET    /api/products/categories/list`);
    console.log(`    GET    /api/products/:id`);
    console.log(`    POST   /api/products             (admin only)`);
    console.log(`    PUT    /api/products/:id          (admin only)`);
    console.log(`    DELETE /api/products/:id          (admin only)`);
    console.log(`    GET    /api/favorites             (user/admin)`);
    console.log(`    POST   /api/favorites             (user/admin)`);
    console.log(`    DELETE /api/favorites/:productId   (user/admin)`);
    console.log(`    GET    /api/dashboard              (admin only)`);
    console.log(`    POST   /api/chatbot/message        (guest/user/admin)`);
    console.log(`  ─────────────────────────────────────────────\n`);
  });
});
