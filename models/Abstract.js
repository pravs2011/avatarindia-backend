const mongoose = require("mongoose");

const abstractSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      default: "Abstract",
    },
    year: {
      type: Number,
      required: true,
      min: 2000,
    },
    description: {
      type: String,
      required: false,
      default: "",
    },
    content: {
      type: String,
      required: false,
      default: "",
    },
    sort_order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Abstract", abstractSchema);
