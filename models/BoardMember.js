const mongoose = require("mongoose");

const boardMemberSchema = new mongoose.Schema(
  {
    profile_picture_url: {
      type: String,
      required: false,
      max: 255,
    },
    profile_name: {
      type: String,
      required: false,
      max: 255,
    },
    profile_designation: {
      type: String,
      required: false,
      max: 255,
    },
    profile_description: {
      type: String,
      required: false,
      max: 255,
    },
    profile_email: {
      type: String,
      required: false,
      max: 255,
    },
    profile_phone: {
      type: String,
      required: false,
      max: 255,
    },
    profile_linkedin: {
      type: String,
      required: false,
      max: 255,
    },
    profile_twitter: {
      type: String,
      required: false,
      max: 255,
    },
    profile_facebook: {
      type: String,
      required: false,
      max: 255,
    },
    profile_instagram: {
      type: String,
      required: false,
      max: 255,
    },
    profile_youtube: {
      type: String,
      required: false,
      max: 255,
    },
    profile_linkedin: {
      type: String,
      required: false,
      max: 255,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("BoardMember", boardMemberSchema);
