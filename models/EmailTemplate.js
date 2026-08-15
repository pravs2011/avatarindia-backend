const mongoose = require("mongoose");

/**
 * EmailTemplate - admin-customizable email templates (subject + HTML body).
 *
 * Placeholders like {{memberName}} / {{otp}} / {{loginUrl}} are replaced with
 * the real values at send time. The template_key identifies which email the
 * template is used for (e.g. "otp", "consent_reminder", "consent_revoked",
 * "consent_deleted").
 */
const emailTemplateSchema = new mongoose.Schema(
  {
    template_key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    subject: { type: String, required: true, trim: true },
    html: { type: String, required: true },
    updated_by: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("EmailTemplate", emailTemplateSchema);
