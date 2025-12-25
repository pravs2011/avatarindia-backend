//const router = require("express").Router();
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const RateLimit = require("express-rate-limit");
const svgCaptcha = require("svg-captcha");
const {
  registerValidation,
  loginValidation,
  updateValidation,
} = require("../validation");
const verify = require("./verifyToken");

const { createLog } = require("./logreport");
const { decodeTextbase64 } = require("./helper");
const { getAttempt, addAttempt, deleteAttempt } = require("./attempt");
const { saveCaptchaCode, checkCaptchaCode } = require("./captchacodes");

// Each IP can only send 5 login requests in 10 minutes
const loginRateLimiter = RateLimit({ max: 5, windowMS: 60000 });

const maxNumberOfFailedLogins = 3;
const timeWindowForFailedLogins = 1 * 60 * 1000; //5 minutes

router.get("/", verify, async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  //res.json(savedUser);

  try {
    res.json({
      users: users,
      //user_logged: req.user,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

//Check if session is valid
router.get("/check", verify, async (req, res) => {
  try {
    // If verify middleware passed, token is valid
    res.status(200).json({
      isAuthenticated: true,
      user: {
        _id: req.user._id,
        name: req.user.name,
        role: req.user.role,
      },
    });
  } catch (err) {
    res.status(401).json({
      isAuthenticated: false,
      error: "Invalid or expired session",
    });
  }
});

//GetCaptcha
router.get("/cpt", async (req, res) => {
  const captcha = svgCaptcha.create();
  const captchaText = captcha.text;
  const captchaSvg = captcha.data;

  const salt = await bcrypt.genSalt(10);
  const hashedCaptcha = await bcrypt.hash(captchaText, salt);

  const base64StringCaptcha = Buffer.from(hashedCaptcha).toString("base64");

  //Creation of New Administrator When the New Deployment is done
  const chkAdmin = await User.find();
  if (!chkAdmin.length) {
    console.log("No Admin Account Found!");
    //Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(process.env.FIRST_TIME_CRED, salt);
    // Creating the Account
    const adminUser = new User({
      first_name: "Administrator",
      last_name: "",
      mobile: "9811951091",
      email: "admin@gmail.com",
      password: hashedPassword,
      role: "FULL_ACCESS",
      user_type: "Administrator",
      account_status: true,
    });
    try {
      const savedAdmin = await adminUser.save();
      if (savedAdmin) {
        console.log(
          `Admin Account Created Successfully with ID : ${savedAdmin._id}`
        );
      }
    } catch (error) {
      console.log(`Error in creating admin account : ${error}`);
    }
  }

  if (hashedCaptcha) {
    await saveCaptchaCode(hashedCaptcha);
    res.setHeader("auth-token", base64StringCaptcha);
    res.json({
      svg: captchaSvg,
      atoken: base64StringCaptcha,
    });
  }
});

//Get a single user Profile
router.get("/:id", verify, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    //res.json(savedUser);
    res.json({
      users: user,
      user_logged: req.user,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

//Get all Users for State
router.get("/state/:state", verify, async (req, res) => {
  const users = await User.find({
    tc_state: decodeTextbase64(req.params.state),
  }).sort({ createdAt: -1 });

  try {
    //res.json(savedUser);
    res.json({
      users: users,
      user_logged: req.user,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

//Get All doctors for TC
router.get("/doc/:tcid", verify, async (req, res) => {
  try {
    const users = await User.find({
      tc_id: req.params.tcid,
      user_type: "Doctor",
    });
    //res.json(savedUser);
    res.json({
      doctors: users,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

router.post("/tokenverify", verify, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      token: true,
      user: {
        name: user.first_name,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

router.post("/register", verify, async (req, res) => {
  console.log(req.body);
  //Validate User before Registering
  const { error } = registerValidation({
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    // mobile: req.body.mobile,
    email: req.body.email,
    password: req.body.password,
    role: req.body.role,
    user_type: req.body.user_type,
  });

  error && console.log(error);
  if (error)
    return res
      .status(400)
      .json({ error: `validation error: ${error.details[0].message}` });

  //Check if user exists
  const emailExist = await User.findOne({ email: req.body.email });
  if (emailExist)
    return res.status(400).json({
      error: "Email already registered, use a different email id !!!",
    });

  // Validate password confirmation
  if (req.body.password !== req.body.confirm_password) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  //Hash the password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(req.body.password, salt);

  const base64String = Buffer.from(req.body.password).toString("base64");
  const log_id = await createLog({
    log_detail: JSON.stringify({
      ...req.body,
      password: base64String,
    }),
    user: req.user._id,
    activity: "Register",
    page: "register",
    route: "/register",
  });

  if (!req.body.role)
    return res.status(400).json({ error: "User Role is not selected!!!" });

  if (!req.body.department_id)
    return res.status(400).json({ error: "Department is not selected!!!" });

  if (!req.body.role_id)
    return res.status(400).json({ error: "Role ID is required!!!" });

  const user = new User({
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    // mobile: req.body.mobile,
    email: req.body.email,
    password: hashedPassword,
    role: req.body.role,
    role_id: req.body.role_id,
    user_type: req.body.user_type,
    account_status: req.body.account_status,
    department_id: req.body.department_id,
  });

  try {
    const savedUser = await user.save();
    res.status(200).json({ user: "User Creation Success!" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/update/:id", verify, async (req, res) => {
  // console.log(req.body);
  // console.log(decodeTextbase64(req.body.id));
  const checkRecord = await User.findById(req.params.id)
    .select("+password")
    .populate({
      path: "password_history",
      select: "-_id", // Exclude the _id field from the result
    });

  // console.log(checkRecord);
  const requestingUser = await User.findById(req.user._id);

  // console.log(requestingUser);
  //Check if user exists
  const emailExist = await User.findOne({ email: req.body.email });
  if (!emailExist)
    return res.status(400).send("Internal Error Kindly check your credentials");

  if (req.body.first_name) {
    checkRecord.first_name = req.body.first_name;
  }
  if (req.body.last_name) {
    checkRecord.last_name = req.body.last_name;
  }
  if (req.body.mobile) {
    checkRecord.mobile = req.body.mobile;
  }

  checkRecord.patient_import_status = req.body.patient_import_status;
  checkRecord.doctor_drop_down_status = req.body.doctor_drop_down_status;

  if (req.user._id === req.body._id && req.body.account_status === false) {
    return res.status(400).json({
      message:
        "Cannot Disable the Loggedin Account! Use any other account to disable",
    });
  }

  checkRecord.account_status = req.body.account_status;

  let base64String = null;

  if (req.body.password) {
    base64String = Buffer.from(req.body.password).toString("base64");
    const check_pass_history =
      checkRecord?.password_history.includes(base64String);

    if (check_pass_history) {
      return res
        .status(400)
        .json({ message: "Password already used, please use new password!" });
    } else {
      checkRecord.password_history.length
        ? (checkRecord.password_history = [
            ...checkRecord?.password_history,
            base64String,
          ])
        : (checkRecord.password_history = [base64String]);
    }

    //Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);
    checkRecord.password = hashedPassword;
  }

  //Validate User before Registering
  const { error } = updateValidation({
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    // mobile: req.body.mobile,
    email: req.body.email,
    role: req.body.role,
    user_type: req.body.user_type,
    employee_id: req.body.employee_id,
    password: req.body.password ? req.body.password : checkRecord.password,
  });

  if (error) return res.status(400).json({ message: `Invalid User/Password!` });

  // console.log(req.body);

  const adminRoles = ["FULL_ACCESS"];
  try {
    if (adminRoles.includes(requestingUser.role)) {
      const savedUser = await checkRecord.save();

      const log_id = await createLog({
        data: JSON.stringify({ old: checkRecord, new: req.body }),
        user: req.user._id,
        activity: "Update",
        page: "update",
        ip_information: req.ip,
        route: "/update",
      });

      res.status(200).json({ message: "Update Success!" });
    } else {
      res
        .status(403)
        .json({ message: "You are not authorized to perform this action" });
    }
  } catch (err) {
    res.status(400).send(err);
  }
});

//User Profile Update
router.post("/profile/update/", verify, async (req, res) => {
  //Check If the record exist for his profile
  const checkRecord = await User.findById(req.user._id)
    .select("+password")
    .populate({
      path: "password_history",
      select: "-_id", // Exclude the _id field from the result
    });

  if (!checkRecord)
    return res.status(400).send(`Unauthorised access is prohibited`);

  const log_id = await createLog({
    data: JSON.stringify({ old: checkRecord, new: req.body }),
    user: req.user._id,
    activity: "Update",
    page: "update",
    ip_information: req.ip,
    route: "/update",
  });

  if (req.body.first_name) {
    checkRecord.first_name = req.body.first_name;
  }
  if (req.body.last_name) {
    checkRecord.last_name = req.body.last_name;
  }
  // if (req.body.mobile) {
  //   checkRecord.mobile = req.body.mobile;
  // }

  if (!req.body.old_password)
    return res.status(400).json({ message: "Current password is required!" });

  if (req.body.old_password === req.body.password)
    return res.status(400).json({ message: "Current password is Unchanged!" });

  const validPass = await bcrypt.compare(
    req.body.old_password,
    checkRecord.password
  );

  if (!validPass) {
    return res.status(400).json({ message: "Invalid Credentials" });
  }

  if (req.body.password) {
    const base64String = Buffer.from(req.body.password).toString("base64");
    const check_pass_history =
      checkRecord?.password_history.includes(base64String);

    if (check_pass_history) {
      return res
        .status(400)
        .json({ message: "Password already used, please use new password!" });
    } else {
      checkRecord.password_history.length
        ? (checkRecord.password_history = [
            ...checkRecord?.password_history,
            base64String,
          ])
        : (checkRecord.password_history = [base64String]);
    }
  }

  if (req.body.password) {
    //Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);
    checkRecord.password = hashedPassword;
  }

  //Validate User before Registering
  const { error } = updateValidation({
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    // mobile: req.body.mobile,
    email: req.body.email,
    password: req.body.password ? req.body.password : checkRecord.password,
  });

  if (error) {
    if (error.details[0].path.includes("password")) {
      return res.status(400).json({ message: "Password too simple!" });
    } else {
      return res.status(400).json({ message: error.details[0].message });
    }
  }

  try {
    const savedUser = await checkRecord.save();
    res.status(200).json({ message: "Update Success!" });
  } catch (error) {
    res.status(400).json({ message: "Internal API Error!" });
  }
});

//Doctor Update
router.post("/doc/update", verify, async (req, res) => {
  console.log(req.body);
  //Check If the record exist for his profile
  const checkRecord = await User.findById(req.body._id)
    .select("-password")
    .populate({
      path: "password_history",
      select: "-_id", // Exclude the _id field from the result
    });

  if (!checkRecord)
    return res.status(400).send(`Unauthorised access is prohibited`);

  if (req.body.first_name) {
    checkRecord.first_name = req.body.first_name;
  }

  if (req.body.last_name) {
    checkRecord.last_name = req.body.last_name;
  }

  if (req.body.mobile) {
    checkRecord.mobile = req.body.mobile;
  }

  if (req.body.email) {
    checkRecord.email = req.body.email;
  }
  checkRecord.doctor_drop_down_status = req.body.doctor_drop_down_status;

  try {
    const savedUser = await checkRecord.save();
    res.status(200).json({ message: "Update Success!" });
  } catch (error) {
    res.status(400).json({ message: "Internal API Error!" });
  }
});

//Login function
router.post("/login", loginRateLimiter, async (req, res) => {
  //console.log(req.body);
  console.log(req.headers);
  //console.log(req);

  let decodeCaptcha = null;
  if (req.headers["auth-token"]) {
    decodeCaptcha = Buffer.from(req.headers["auth-token"], "base64").toString(
      "ascii"
    );
    // Do something with the decoded captcha
  } else {
    return res.status(400).json({ error: "Internal Error Kindly Retry" });
  }

  if (!decodeCaptcha.split("_")) {
    console.log("Can't decode");
  }
  const captchaArray = decodeCaptcha.split("_");
  const captchaText = Buffer.from(captchaArray[0], "base64").toString("ascii");

  const captchaHash = Buffer.from(captchaArray[1], "base64").toString("ascii");
  // console.log(captchaText);
  // console.log(captchaArray[1]);

  if (!checkCaptchaCode(captchaHash)) {
    return res.status(400).json({ error: "Captcha Expired kindly refresh" });
  }

  const validCaptcha = await bcrypt.compare(captchaText, captchaHash);

  if (!validCaptcha) {
    return res.status(400).json({ error: "Internal Error Kindly Retry" });
  }

  //Decode credentials
  const decode = (data) => {
    return decodeURIComponent(
      escape(
        Buffer.from(data, "base64")
          .toString("utf-8")
          .split("")
          .reverse()
          .join("")
      )
    );
  };

  const { email, password } = JSON.parse(decode(req.body.cred));

  const decodedEmail = email;

  //check if valid Email
  const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
  };

  if (!validateEmail(email))
    return res.status(400).json({ error: "Internal Error Kindly Retry" });

  const encodedPassword = password;

  //Private key to decode password
  const private_key = "XkhZG4fW2t2WZG4fWZG4fW2t2W";
  const decodedPasswordWithKey = Buffer.from(
    // req.body.password,
    encodedPassword,
    "base64"
  ).toString();
  const decodedPassword = decodedPasswordWithKey.split("-")[0];

  // console.log("Credentials: ", credentials);

  // return;

  if (decodedPasswordWithKey.split("-")[1] !== private_key) {
    console.log("Invalid custom key");
    return res.status(400).json({ error: "Internal Error Kindly Retry" });
  }

  //Validate User before Login
  const { error } = loginValidation({
    email: decodedEmail,
    password: decodedPassword,
  });

  if (error) return res.status(400).json({ error: "Invalid Credentials" });
  //if (error) return res.status(400).send(error.details[0].message);

  let userAttempts = await getAttempt(req.body.email);

  userAttempts = userAttempts ? userAttempts : 0;

  //Check if user exists
  const user = await User.findOne({
    email: decodedEmail,
    account_status: true,
  }).select("+password");

  if (!user)
    return res.status(400).json({
      error: "Invalid Credentials, please contact Administrator",
    });

  if (!user?.account_status)
    return res.status(400).json({
      error: "The Account is deactivated. Please contact Admin for activation",
    });

  if (userAttempts > maxNumberOfFailedLogins) {
    if (user) {
      const setId = setTimeout(async () => {
        await deleteAttempt(user, req.ip);
        console.log("LogSet");
      }, 60000);
      console.log(setId);
    }
    return res
      .status(400)
      .json({ error: "Too Many Attempts try it 1 minutes later" });
  }

  if (!user) return res.status(400).json({ error: "Invalid Credentials" });

  //console.log(decodedPassword);
  //If password is correct
  const validPass = await bcrypt.compare(decodedPassword, user.password);
  if (!validPass) {
    await addAttempt({ user_attempt: ++userAttempts, email: user.email });
    return res.status(400).json({ error: "Invalid Credentials" });
  }

  //Get TC record
  // const tcRecord = await TreatmentCenter.findById(user.tc_id);
  // console.log(tcRecord);

  await deleteAttempt(user, req.ip);
  //Create and assign a token
  const token = jwt.sign(
    {
      _id: user._id,
      name: user.first_name + " " + (user.last_name ? user.last_name : ""),
      role: user.role,
    },
    process.env.JWT_TOKEN_SECRET,
    {
      expiresIn: process.env.JWT_ACCESS_TIME,
    }
  );

  //refresh-token Created but not yet used..
  const refresh_token = jwt.sign(
    {
      _id: user._id,
      role: user.role,
    },
    process.env.JWT_TOKEN_REFRESH,
    { expiresIn: process.env.JWT_REFRESH_TIME }
  );

  //Log information
  const base64String = Buffer.from(encodedPassword).toString("base64");

  const log_id = await createLog({
    log_detail: JSON.stringify({
      email: req.body.email,
      password: base64String,
    }),
    user: user._id,
    activity: "Login",
    page: "login",
    ip_information: req.ip,
    route: "/login",
  });
  //Logging Ends

  res.setHeader("auth-token", token);
  res.status(200).send("Login successful");
});

//(D) Delete the Patient by ID
router.delete("/delete/:id", verify, async (req, res) => {
  //Check if Patient _id exists
  const userExist = await User.findById(req.params.id);

  if (req.user._id === req.params.id) {
    return res
      .status(400)
      .json({ message: "Cannot delete Current User record" });
  }

  const log_id = await createLog({
    data: JSON.stringify(userExist),
    user: req.user._id,
    activity: "Delete",
    page: "delete",
    ip_information: req.ip,
    route: "/delete",
  });

  if (!userExist)
    return res.status(400).json({ message: "Record Doesn't Exists" });

  const userRoles = ["FULL_ACCESS"];

  if (userRoles.includes(req.user.role)) {
    console.log("About to delete user ", userExist);
    try {
      await userExist.deleteOne();
      res.json({ message: "Deleted Record sucessfully" });
    } catch (err) {
      console.log("Error deleting user ", err);
      res.status(500).json({ message: `Record Doesn't Exists ${err}` });
    }
  } else {
    console.log("User role not allowed to delete");
    res
      .status(500)
      .json({ message: "You are not allowed to delete the records" });
  }
});

module.exports = router;
