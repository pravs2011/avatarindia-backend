const mongoose = require("mongoose");

const memberBackupSettingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    frequency: { type: String, enum: ["daily", "weekly", "monthly"], default: "weekly" },
    lastSentAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MemberBackupSetting", memberBackupSettingSchema);
