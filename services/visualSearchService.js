const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const pythonBin = process.env.DINO_PYTHON_BIN || "/home/abghany/amzon/.venv/bin/python";
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
      reject(new Error("Visual worker startup timed out."));
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
        else item.reject(new Error(payload.error || "Visual worker error"));
      }
    });

    worker.stderr.on("data", () => {});

    worker.on("exit", () => {
      for (const [, item] of pending) {
        item.reject(new Error("Visual worker exited unexpectedly."));
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

async function ensurePipelineVectors() {
  return sendCommand({ cmd: "sync-pipeline", force: false });
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

module.exports = {
  ensurePipelineVectors,
  searchVisual,
  upsertProductVector,
  deleteProductVector,
};
