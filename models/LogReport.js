const mongoose = require("mongoose");
const User = require("./User");

const logSchema = new mongoose.Schema(
  {
    log_detail: {
      type: String,
    },
    activity: {
      type: String,
    },
    data: {
      type: String,
    },
    page: {
      type: String,
    },
    page_route: {
      type: String,
    },
    ip_information: {
      type: String,
    },
    user_id: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: User,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("AuditLog", logSchema);
