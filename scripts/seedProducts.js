require("dotenv").config();
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const connectDB = require("../config/db");
const Product = require("../models/Product");
const User = require("../models/User");

const AMZON_BASE_DIR = process.env.AMZON_BASE_DIR || "/home/abghany/amzon";
const DATASET_DIR = path.join(AMZON_BASE_DIR, "data");
const VISUAL_DATASET_DIR = path.join(AMZON_BASE_DIR, "final_data", "visual_dataset");
const VISUAL_CSV = path.join(VISUAL_DATASET_DIR, "Amazon-Products-Visual.csv");
const FINAL_CSV = path.join(DATASET_DIR, "Amazon-Products-Final.csv");

function safeNumber(val) {
  const num = parseFloat(val);
  return Number.isNaN(num) ? 0 : num;
}

function parseRatingsCount(val) {
  if (!val) return 0;
  return safeNumber(String(val).replace(/,/g, ""));
}

function normalizeText(val) {
  return String(val || "").trim();
}

function normalizeProductFromRow(row, visualByLink, rowIndex) {
  const link = normalizeText(row.link);
  const visualImageRel = link && visualByLink.has(link) ? visualByLink.get(link) : "";
  const indexedImagePath = path.join(VISUAL_DATASET_DIR, "images", `prod_${rowIndex}.jpg`);
  let imageLocal = "";
  if (visualImageRel) {
    imageLocal = path.join(VISUAL_DATASET_DIR, visualImageRel.replace(/^\.?\//, ""));
  } else if (fs.existsSync(indexedImagePath)) {
    imageLocal = indexedImagePath;
  }
  const discountPrice = safeNumber(row.discount_price_usd);
  const actualPrice = safeNumber(row.actual_price_usd);
  const discountPercentage =
    row.discount_percentage !== undefined && row.discount_percentage !== ""
      ? safeNumber(row.discount_percentage)
      : actualPrice > 0
        ? ((actualPrice - discountPrice) / actualPrice) * 100
        : 0;
  return {
    name: normalizeText(row.name),
    main_category: normalizeText(row.main_category),
    sub_category: normalizeText(row.sub_category),
    image_url: normalizeText(row.image_url || row.image),
    image_local: imageLocal,
    link,
    ratings: safeNumber(row.ratings),
    no_of_ratings: parseRatingsCount(row.no_of_ratings),
    description: normalizeText(row.description),
    discount_price_usd: discountPrice,
    actual_price_usd: actualPrice,
    discount_percentage: discountPercentage,
  };
}

function loadVisualImageMap() {
  if (!fs.existsSync(VISUAL_CSV)) return Promise.resolve(new Map());
  const mapping = new Map();
  return new Promise((resolve, reject) => {
    fs.createReadStream(VISUAL_CSV)
      .pipe(csv())
      .on("data", (row) => {
        const link = normalizeText(row.link);
        const image = normalizeText(row.image);
        if (link && image) {
          mapping.set(link, image);
        }
      })
      .on("end", () => resolve(mapping))
      .on("error", reject);
  });
}

function listCandidateCsvs() {
  if (fs.existsSync(FINAL_CSV)) return [FINAL_CSV];
  if (!fs.existsSync(DATASET_DIR)) return [];
  return fs
    .readdirSync(DATASET_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .filter((f) => !f.startsWith("chunk_") && !f.startsWith("results_"))
    .map((f) => path.join(DATASET_DIR, f))
    .sort();
}

async function readProductsFromCsv(csvPath, visualByLink) {
  const products = [];
  let rowIndex = -1;
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        rowIndex += 1;
        const product = normalizeProductFromRow(row, visualByLink, rowIndex);
        if (!product.name || !product.main_category) return;
        products.push(product);
      })
      .on("end", resolve)
      .on("error", reject);
  });
  return products;
}

function dedupeProducts(rows) {
  const seen = new Map();
  for (const row of rows) {
    const dedupeKey =
      row.link || `${row.name.toLowerCase()}::${row.main_category.toLowerCase()}::${row.sub_category.toLowerCase()}`;
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, row);
      continue;
    }
    const existing = seen.get(dedupeKey);
    if (!existing.image_local && row.image_local) {
      seen.set(dedupeKey, row);
    }
  }
  return Array.from(seen.values());
}

async function seed() {
  await connectDB();

  const visualByLink = await loadVisualImageMap();
  const csvFiles = listCandidateCsvs();
  if (csvFiles.length === 0) {
    throw new Error(`No dataset CSV files found in ${DATASET_DIR}`);
  }

  const allRows = [];
  for (const csvPath of csvFiles) {
    // eslint-disable-next-line no-console
    console.log(`Reading CSV: ${csvPath}`);
    const rows = await readProductsFromCsv(csvPath, visualByLink);
    allRows.push(...rows);
  }

  const products = dedupeProducts(allRows);
  await Product.deleteMany({});
  await Product.insertMany(products, { ordered: false });
  // eslint-disable-next-line no-console
  console.log(`Inserted ${products.length} products into MongoDB.`);

  const adminEmail = "admin@omnifind.com";
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: "Admin",
      email: adminEmail,
      password: "admin123",
      role: "admin",
    });
    // eslint-disable-next-line no-console
    console.log(`Default admin created (${adminEmail} / admin123)`);
  }

  // eslint-disable-next-line no-console
  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Seed failed:", err);
  process.exit(1);
});
