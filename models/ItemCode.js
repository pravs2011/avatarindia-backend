const mongoose = require("mongoose");

const itemCodeSchema = new mongoose.Schema(
  {
    item_name: {
      type: String,
    },
    item_prefix: {
      type: String,
    },
    item_code: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ItemCode", itemCodeSchema);
