const mongoose = require("mongoose");

/**
 * ConsentLog - Immutable audit trail of consent lifecycle events per member.
 *
 * Kept as a separate collection so the history survives even when a member
 * record is deleted (right to erasure) and so admins can see exactly who did
 * what, when, for every consent change.
 *
 * action values:
 *   GRANTED - consent given (registration or member re-granting)
 *   REVOKED - consent withdrawn (member or admin)
 *   DELETED - consent record erased (member record deleted / admin erasure)
 */
const consentLogSchema = new mongoose.Schema(
  {
    memberId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "Registration",
      default: null,
    },
    registrationNo: { type: String, required: true },
    memberName: { type: String, default: "" },
    memberEmail: { type: String, default: "" },
    action: {
      type: String,
      enum: ["GRANTED", "REVOKED", "DELETED"],
      required: true,
    },
    // Who performed the action, e.g. "Member (online registration)",
    // "Member", or "Admin: <admin name>"
    performedBy: { type: String, required: true },
    // Reference to the admin user when an admin performed the action
    performedById: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "User",
      default: null,
    },
    details: { type: String, default: "" },
  },
  { timestamps: true },
);

consentLogSchema.index({ registrationNo: 1, createdAt: -1 });
consentLogSchema.index({ memberId: 1, createdAt: -1 });

module.exports = mongoose.model("ConsentLog", consentLogSchema);
