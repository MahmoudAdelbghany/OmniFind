const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
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

module.exports = connectDB;
