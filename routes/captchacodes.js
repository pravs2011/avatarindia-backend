const CaptchaCode = require("../models/CaptchaCode");

const saveCaptchaCode = async (captcha_code) => {
  const captchaExist = await CaptchaCode.findOne({
    captcha_code: captcha_code,
    status: "active",
  });

  if (!captchaExist) {
    const captchaCode = new CaptchaCode({
      captcha_code: captcha_code,
      status: "active",
    });

    try {
      await captchaCode.save();
    } catch (error) {
      console.log(error);
    }
  }
};

const checkCaptchaCode = async (captcha_code) => {
  const captchaExist = await CaptchaCode.findOne({
    captcha_code: captcha_code,
    status: "active",
  });

  if (captchaExist) {
    captchaExist.status = "checked";
    try {
      await captchaExist.save();
      return false;
    } catch (error) {
      console.log(error);
    }
  } else {
    return true;
  }
};

module.exports.saveCaptchaCode = saveCaptchaCode;
module.exports.checkCaptchaCode = checkCaptchaCode;
