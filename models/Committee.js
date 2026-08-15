const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: false,
      max: 255,
    },
    designation: {
      type: String,
      required: false,
      max: 255,
    },
    info: {
      type: String,
      required: false,
      max: 2000,
    },
    photo: {
      type: String,
      required: false,
      max: 255,
    },
  },
  {
    _id: true,
  },
);

const sectionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: false,
      default: "",
      max: 255,
    },
    subtitle: {
      type: String,
      required: false,
      default: "",
      max: 255,
    },
    members: {
      type: [memberSchema],
      default: [],
    },
  },
  {
    _id: true,
  },
);

const committeeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: false,
      max: 255,
    },
    description: {
      type: String,
      required: false,
      max: 2000,
    },
    sections: {
      type: [sectionSchema],
      default: [],
    },
    sort_order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Committee", committeeSchema);
