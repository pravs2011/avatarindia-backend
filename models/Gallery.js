const mongoose = require("mongoose");

const gallerySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      max: 255,
    },
    description: {
      type: String,
      required: false,
      max: 1000,
    },
    images: {
      type: [String],
      default: [],
    },
    sort_order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Gallery", gallerySchema);
