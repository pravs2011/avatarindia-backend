const mongoose = require("mongoose");

/**
 * Document - a file uploaded by an admin for members to download.
 * visibility PUBLIC: downloadable by any logged-in member.
 * visibility PRIVATE: downloadable only by the member it is intended for.
 */
const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, max: 255 },
    description: { type: String, default: "", max: 1000 },
    visibility: {
      type: String,
      enum: ["PUBLIC", "PRIVATE"],
      default: "PUBLIC",
      required: true,
    },
    // Relative file path on disk, e.g. "documents/doc-1712345678901.pdf"
    filePath: { type: String, required: true },
    // Original file name, used as the download name
    fileName: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: "" },
    // For PRIVATE documents - the member it is intended for
    memberId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "Registration",
      default: null,
    },
    registrationNo: { type: String, default: "" },
    memberName: { type: String, default: "" },
    uploadedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

documentSchema.index({ visibility: 1, createdAt: -1 });
documentSchema.index({ memberId: 1, createdAt: -1 });

module.exports = mongoose.model("Document", documentSchema);
