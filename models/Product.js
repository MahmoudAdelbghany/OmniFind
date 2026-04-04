const mongoose = require("mongoose");

// ─────────────────────────────────────────────
//  Product Schema
//  Matches the Amazon Products CSV columns
// ─────────────────────────────────────────────

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    main_category: {
      type: String,
      required: true,
      trim: true,
    },
    sub_category: {
      type: String,
      trim: true,
    },
    image_url: {
      type: String,
    },
    image_local: {
      type: String,
    },
    link: {
      type: String,
    },
    ratings: {
      type: Number,
      default: 0,
    },
    no_of_ratings: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
    },
    discount_price_usd: {
      type: Number,
      default: 0,
    },
    actual_price_usd: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

// ── Text index for basic search ──
productSchema.index({
  name: "text",
  description: "text",
  main_category: "text",
});

module.exports = mongoose.model("Product", productSchema);
