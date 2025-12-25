const mongoose = require("mongoose");
const User = require("./User");

const errorSchema = new mongoose.Schema(
  {
    error_log: {
      type: String,
    },
    page: {
      type: String,
    },
    page_route: {
      type: String,
    },
    user_id: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: User,
    },
    resolution_status: {
      type: Boolean,
      default: false,
    },
    resolved_by: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: User,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ErrorReport", errorSchema);
