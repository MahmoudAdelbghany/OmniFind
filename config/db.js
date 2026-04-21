const mongoose = require("mongoose");
const os = require("os");
const path = require("path");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoMemoryServer = null;

async function resolveMongoUri() {
  const mongoUri = String(process.env.MONGO_URI || "").trim();
  if (mongoUri) return mongoUri;

  const baseDir = process.env.MONGOMS_DOWNLOAD_DIR || path.join(os.tmpdir(), "omnifind-mongod-bin");
  mongoMemoryServer = await MongoMemoryServer.create({
    binary: { downloadDir: baseDir },
    instance: { dbName: "omnifind" },
  });
  const inMemoryUri = mongoMemoryServer.getUri("omnifind");
  console.log("MONGO_URI not set. Started local mongodb-memory-server instance.");
  return inMemoryUri;
}

function allowMemoryFallback() {
  const raw = String(process.env.MONGO_ALLOW_MEMORY_FALLBACK || "").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no");
}

const connectDB = async () => {
  const preferredUri = String(process.env.MONGO_URI || "").trim();
  try {
    const mongoUri = await resolveMongoUri();
    const conn = await mongoose.connect(mongoUri);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    if (preferredUri && allowMemoryFallback()) {
      try {
        const baseDir = process.env.MONGOMS_DOWNLOAD_DIR || path.join(os.tmpdir(), "omnifind-mongod-bin");
        mongoMemoryServer = await MongoMemoryServer.create({
          binary: { downloadDir: baseDir },
          instance: { dbName: "omnifind" },
        });
        const fallbackUri = mongoMemoryServer.getUri("omnifind");
        const conn = await mongoose.connect(fallbackUri);
        console.warn("Primary MONGO_URI failed. Fell back to local mongodb-memory-server.");
        console.log(`MongoDB connected: ${conn.connection.host}`);
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
  if (mongoMemoryServer) {
    await mongoMemoryServer.stop();
  }
});

module.exports = connectDB;
