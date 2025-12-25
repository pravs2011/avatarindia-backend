const mongoose = require("mongoose");

const attemptSchema = new mongoose.Schema(
  {
    user_attempt: {
      type: Number,
      default: 0,
    },
    email: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Attempt", attemptSchema);
