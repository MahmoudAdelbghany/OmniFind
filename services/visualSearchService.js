const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const pythonBin =
  process.env.DINO_PYTHON_BIN ||
  (fs.existsSync("/home/abghany/amzon/.venv312_omnifind/bin/python")
    ? "/home/abghany/amzon/.venv312_omnifind/bin/python"
    : "/home/abghany/amzon/.venv/bin/python");
const workerScript = path.join(__dirname, "..", "scripts", "visual_pipeline_worker.py");

let worker = null;
let workerReady = null;
let requestCounter = 0;
const pending = new Map();

function ensureWorker() {
  if (worker && workerReady) return workerReady;

  worker = spawn(pythonBin, [workerScript], {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const rl = readline.createInterface({ input: worker.stdout });
  workerReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Qdrant worker startup timed out."));
    }, 120000);

    rl.on("line", (line) => {
      let payload;
      try {
        payload = JSON.parse(line);
      } catch (_err) {
        return;
      }

      if (payload.ready) {
        clearTimeout(timer);
        resolve(true);
        return;
      }

      if (payload.id && pending.has(payload.id)) {
        const item = pending.get(payload.id);
        pending.delete(payload.id);
        if (payload.ok) item.resolve(payload.result);
        else item.reject(new Error(payload.error || "Qdrant worker error"));
      }
    });

    worker.stderr.on("data", () => {});

    worker.on("exit", () => {
      for (const [, item] of pending) {
        item.reject(new Error("Qdrant worker exited unexpectedly."));
      }
      pending.clear();
      worker = null;
      workerReady = null;
    });
  });

  return workerReady;
}

async function sendCommand(command) {
  await ensureWorker();
  const id = `req-${Date.now()}-${++requestCounter}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
  });
}

// ── Helpers ──

function coerceNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTextPayload(product) {
  const discountPrice = coerceNumber(product.discount_price_usd) || 0;
  const actualPrice = coerceNumber(product.actual_price_usd) || 0;
  const explicitDiscount = coerceNumber(product.discount_percentage);

  let discountPercentage = explicitDiscount;
  if (discountPercentage === null && actualPrice > 0) {
    discountPercentage = Math.max(0, (actualPrice - discountPrice) / actualPrice);
  }

  return {
    product_id: String(product._id || product.product_id || ""),
    name: product.name || "",
    main_category: product.main_category || "",
    sub_category: product.sub_category || "",
    description: product.description || "",
    discount_price_usd: discountPrice,
    actual_price_usd: actualPrice,
    discount_percentage: discountPercentage || 0,
    ratings: coerceNumber(product.ratings) || 0,
    no_of_ratings: coerceNumber(product.no_of_ratings) || 0,
    link: product.link || "",
    image_local: product.image_local || "",
    image_url: product.image_url || "",
  };
}

// ── Visual Search ──

async function ensurePipelineVectors(options = {}) {
  return sendCommand({ cmd: "sync-pipeline", force: Boolean(options.force) });
}

async function searchVisual(imagePath, topK = 12) {
  return sendCommand({ cmd: "search", image: imagePath, top_k: topK });
}

async function upsertProductVector(product, imagePath) {
  return sendCommand({
    cmd: "upsert-product",
    product_id: String(product._id),
    name: product.name || "",
    main_category: product.main_category || "",
    sub_category: product.sub_category || "",
    link: product.link || "",
    image_local: product.image_local || "",
    image: imagePath,
  });
}

async function deleteProductVector(productId) {
  return sendCommand({
    cmd: "delete-product",
    product_id: String(productId),
  });
}

// ── Text Search (OmniFind V2 — hybrid semantic search) ──

async function ensureTextVectors(products, options = {}) {
  const safeProducts = Array.isArray(products) ? products : [];
  const payload = safeProducts.map((product) => toTextPayload(product));

  const tempPath = path.join(
    os.tmpdir(),
    `omnifind-text-sync-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );

  await fs.promises.writeFile(tempPath, JSON.stringify(payload), "utf8");
  try {
    return await sendCommand({
      cmd: "sync-text-index",
      products_file: tempPath,
      force: Boolean(options.force),
    });
  } finally {
    fs.promises.unlink(tempPath).catch(() => {});
  }
}

async function searchText(query, options = {}) {
  return sendCommand({
    cmd: "search-text",
    query,
    top_k: Number(options.topK || 120),
    category: options.category || "",
    sub_category: options.subCategory || "",
    min_price: options.minPrice,
    max_price: options.maxPrice,
    min_rating: options.minRating,
  });
}

async function upsertProductTextVector(product) {
  const payload = toTextPayload(product);
  return sendCommand({
    cmd: "upsert-product-text",
    ...payload,
  });
}

async function deleteProductTextVector(productId) {
  return sendCommand({
    cmd: "delete-product-text",
    product_id: String(productId),
  });
}

module.exports = {
  ensurePipelineVectors,
  searchVisual,
  upsertProductVector,
  deleteProductVector,
  ensureTextVectors,
  searchText,
  upsertProductTextVector,
  deleteProductTextVector,
};
