const mongoose = require("mongoose");

const videoGallerySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      max: 255,
    },
    description: {
      type: String,
      required: false,
      max: 1000,
    },
    videos: {
      type: [String],
      default: [],
    },
    youtube_urls: {
      type: [String],
      default: [],
    },
    youtube_meta: {
      type: [
        {
          id: { type: String },
          title: { type: String, default: "" },
          author: { type: String, default: "" },
          thumbnail: { type: String, default: "" },
        },
      ],
      default: [],
      _id: false,
    },
    sort_order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("VideoGallery", videoGallerySchema);
