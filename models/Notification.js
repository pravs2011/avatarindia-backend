const mongoose = require("mongoose");

/**
 * Notification - admin-facing event feed for membership activity.
 * Events: new registrations, consent granted/revoked/deleted, member deleted.
 * readBy tracks which admin users have seen each notification.
 */
const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "REGISTRATION",
        "CONSENT_GRANTED",
        "CONSENT_REVOKED",
        "CONSENT_DELETED",
        "CONSENT_REMINDED",
        "MEMBER_DELETED",
        "GRIEVANCE",
      ],
      required: true,
    },
    message: { type: String, required: true },
    registrationNo: { type: String, default: "" },
    memberName: { type: String, default: "" },
    memberEmail: { type: String, default: "" },
    // Which audience sees this notification: admins or a specific member.
    audience: {
      type: String,
      enum: ["ADMIN", "MEMBER"],
      default: "ADMIN",
    },
    // For MEMBER-audience notifications: which member it targets.
    memberId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "Registration",
      default: null,
    },
    memberRead: { type: Boolean, default: false },
    // Read state for ADMIN-audience notifications.
    readBy: [{ type: mongoose.SchemaTypes.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
