// ─────────────────────────────────────────────
//  Seed Script
//  Loads products from CSV into MongoDB
//  Creates a default admin account
//
//  Usage: npm run seed
// ─────────────────────────────────────────────

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Product = require("../models/Product");
const User = require("../models/User");

// ── Path to CSV file ──
// First try the 100-product sample, then try the larger dataset
const CSV_SMALL = path.join(__dirname, "..", "data", "Amazon-Products-100.csv");
const CSV_LARGE = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "Amazon-Products-Final.csv",
);

const CSV_PATH = fs.existsSync(CSV_SMALL) ? CSV_SMALL : CSV_LARGE;

// ── Parse a number, return 0 if invalid ──
function safeNumber(val) {
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
}

// ── Parse no_of_ratings which may have commas like "2,060" ──
function parseRatingsCount(val) {
  if (!val) return 0;
  const cleaned = String(val).replace(/,/g, "");
  return safeNumber(cleaned);
}

async function seed() {
  await connectDB();

  // ── 1) Seed Products ──
  console.log(`\nReading CSV: ${CSV_PATH}`);
  const products = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on("data", (row) => {
        products.push({
          name: row.name || "",
          main_category: row.main_category || "",
          sub_category: row.sub_category || "",
          image_url: row.image_url || row.image || "",
          image_local: row.image_local || "",
          link: row.link || "",
          ratings: safeNumber(row.ratings),
          no_of_ratings: parseRatingsCount(row.no_of_ratings),
          description: row.description || "",
          discount_price_usd: safeNumber(row.discount_price_usd),
          actual_price_usd: safeNumber(row.actual_price_usd),
        });
      })
      .on("end", resolve)
      .on("error", reject);
  });

  // Clear existing products and insert new ones
  await Product.deleteMany({});
  console.log(`Cleared existing products.`);

  await Product.insertMany(products);
  console.log(`Inserted ${products.length} products into MongoDB.\n`);

  // ── 2) Create Default Admin ──
  const adminEmail = "admin@omnifind.com";
  const existingAdmin = await User.findOne({ email: adminEmail });

  if (!existingAdmin) {
    await User.create({
      name: "Admin",
      email: adminEmail,
      password: "admin123",
      role: "admin",
    });
    console.log(`Default admin created:`);
    console.log(`  Email:    ${adminEmail}`);
    console.log(`  Password: admin123`);
    console.log(`  (Change this password after first login!)\n`);
  } else {
    console.log(`Admin account already exists (${adminEmail})\n`);
  }

  // ── Done ──
  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
