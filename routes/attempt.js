const Attempt = require("../models/Attempt");
const { createLog } = require("./logreport");

const addAttempt = async (data) => {
  let logAttempt = await Attempt.findOne({
    email: data.email,
  });

  if (!logAttempt) {
    logAttempt = new Attempt({
      user_attempt: data.user_attempt,
      email: data.email,
    });
  } else {
    logAttempt.user_attempt = data.user_attempt;
  }

  try {
    const savedAttempt = await logAttempt.save();
    return savedAttempt._id;
  } catch (err) {
    return err;
  }
};

const getAttempt = async (email) => {
  const attempt = await Attempt.findOne({
    email,
  });
  return attempt?.user_attempt;
};

const deleteAttempt = async (user, ip = null) => {
  const attempt = await Attempt.findOne({
    email: user.email,
  });

  try {
    if (attempt) {
      const log_id = await createLog({
        log_detail: JSON.stringify({
          attempt,
        }),
        user: user._id,
        activity: "Failed",
        page: "login",
        ip_information: ip,
        route: "/login",
      });

      console.log("Deleted Email: ", user.email);
      attempt.remove();
    }
    return true;
  } catch (err) {
    return err;
  }
};

module.exports.addAttempt = addAttempt;
module.exports.getAttempt = getAttempt;
module.exports.deleteAttempt = deleteAttempt;
