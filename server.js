require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const connectDB = require("./config/db");

// ── Import routes ──
const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const favoriteRoutes = require("./routes/favoriteRoutes");

// ── Create Express app ──
const app = express();

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// ── Routes ──
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/favorites", favoriteRoutes);

// ── Health check ──
app.get("/", (req, res) => {
  res.json({ message: "OmniFind API is running", version: "1.0.0" });
});

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error" });
});

// ── Start server ──
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
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
    console.log(`    GET    /api/products/categories/list`);
    console.log(`    GET    /api/products/:id`);
    console.log(`    POST   /api/products             (admin only)`);
    console.log(`    PUT    /api/products/:id          (admin only)`);
    console.log(`    DELETE /api/products/:id          (admin only)`);
    console.log(`    GET    /api/favorites             (user/admin)`);
    console.log(`    POST   /api/favorites             (user/admin)`);
    console.log(`    DELETE /api/favorites/:productId   (user/admin)`);
    console.log(`  ─────────────────────────────────────────────\n`);
  });
});
