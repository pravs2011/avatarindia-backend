const mongoose = require("mongoose");

// Stores the CMS-editable content of a public page (home, about, ...).
// `content` is a page-specific nested object; the shape is defined by
// src/utils/pageContent.js DEFAULT_PAGE_CONTENT on the frontend.
const pageContentSchema = new mongoose.Schema(
  {
    page_key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true, // e.g. "home" | "about"
    },
    content: {
      type: Object,
      required: true,
      default: {},
    },
    updated_by: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PageContent", pageContentSchema);
