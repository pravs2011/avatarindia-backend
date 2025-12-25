const mongoose = require("mongoose");

const captchaCodeSchema = new mongoose.Schema(
  {
    captcha_code: {
      type: String,
    },
    status: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("CaptchaCode", captchaCodeSchema);
