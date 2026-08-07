const mongoose = require("mongoose");

const executiveTypeSchema = new mongoose.Schema(
  {
    executive_type: {
      type: String,
      required: false,
      max: 255,
    },
    executive_type_description: {
      type: String,
      required: false,
      max: 255,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ExecutiveType", executiveTypeSchema);
