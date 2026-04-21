require("dotenv").config();
const connectDB = require("../config/db");
const { seedCatalog } = require("../services/catalogBootstrapService");

async function seed() {
  await connectDB();
  const result = await seedCatalog({ force: true });
  // eslint-disable-next-line no-console
  console.log(`Seed complete! Inserted ${result.count} products.`);
  process.exit(0);
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Seed failed:", err);
  process.exit(1);
});
