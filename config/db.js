const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

let memoryServer = null;

async function startEmbeddedMongo() {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dataDir = path.join(__dirname, "..", "data", "mongodb-memory");
  fs.mkdirSync(dataDir, { recursive: true });
  memoryServer = await MongoMemoryServer.create({
    instance: {
      dbName: "omnifind",
      dbPath: dataDir,
    },
  });
  return memoryServer.getUri();
}

const connectDB = async () => {
  const allowFallback = process.env.MONGO_ALLOW_FALLBACK !== "false";
  try {
    let mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      mongoUri = await startEmbeddedMongo();
      console.log("MONGO_URI not provided. Using local embedded MongoDB instance.");
    }

    const conn = await mongoose.connect(mongoUri);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    if (process.env.MONGO_URI && allowFallback) {
      try {
        const fallbackUri = await startEmbeddedMongo();
        console.warn(`\n  Remote MongoDB unavailable: ${error.message}`);
        console.warn("  Falling back to local embedded MongoDB (set MONGO_ALLOW_FALLBACK=false to disable).");
        const conn = await mongoose.connect(fallbackUri);
        console.log(`MongoDB connected (fallback): ${conn.connection.host}`);
        return;
      } catch (fallbackError) {
        console.error(`\n  MongoDB fallback error: ${fallbackError.message}`);
      }
    }
    console.error(`\n  MongoDB connection error: ${error.message}`);
    console.error(`  ─────────────────────────────────────────────`);
    console.error(`  Possible fixes:`);
    console.error(`    1. Go to MongoDB Atlas → Network Access → Add your IP`);
    console.error(`    2. Or add 0.0.0.0/0 to allow all IPs (for development)`);
    console.error(
      `    3. Check that the username/password in .env are correct`,
    );
    console.error(`  ─────────────────────────────────────────────\n`);
    process.exit(1);
  }
};

process.on("exit", async () => {
  if (memoryServer) {
    await memoryServer.stop();
  }
});

module.exports = connectDB;
