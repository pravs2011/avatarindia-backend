const mongoose = require("mongoose");

/**
 * Grievance - member-filed complaints (data protection, membership, etc.)
 * submitted after logging in with OTP. Admins can track and respond.
 */
const grievanceSchema = new mongoose.Schema(
  {
    memberId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "Registration",
      default: null,
    },
    registrationNo: { type: String, default: "" },
    memberName: { type: String, default: "" },
    memberEmail: { type: String, default: "" },
    category: { type: String, default: "Other" },
    subject: { type: String, required: true },
    description: { type: String, required: true },
    // Discussion thread: the member's original complaint plus every response
    // and follow-up, in order. Old messages are never overwritten.
    messages: {
      type: [
        {
          authorType: {
            type: String,
            enum: ["MEMBER", "ADMIN"],
            required: true,
          },
          author: { type: String, default: "" },
          text: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"],
      default: "OPEN",
    },
    // Legacy single-response field; kept for records created before threads.
    adminNote: { type: String, default: "" },
    resolvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "User",
      default: null,
    },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

grievanceSchema.index({ createdAt: -1 });
grievanceSchema.index({ memberId: 1, createdAt: -1 });

module.exports = mongoose.model("Grievance", grievanceSchema);
