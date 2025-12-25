const router = require("express").Router();
const verify = require("./verifyToken");
const User = require("../models/User");
const AuditLog = require("../models/LogReport");
const { createLog } = require("./logreport");

//(R) Read / Get All Audit Logs
router.get("/", verify, async (req, res) => {
  try {
    const auditLogs = await AuditLog.find()
      .sort({
        createdAt: -1,
      })
      .limit(1000) // Limit the results to the last 1000 records
      .populate("user_id");
    res.json({
      audit_logs: auditLogs,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

//(R) Read / Get All Audit Logs
router.get("/v2", verify, async (req, res) => {
  try {
    // Fetch the last 1000 audit logs, sorted by creation date in descending order
    const auditLogs = await AuditLog.find()
      .sort({ createdAt: -1 }) // Sort by creation date descending
      .limit(1000) // Limit the results to the last 1000 records
      .populate("user_id"); // Populate the 'user_id' field

    res.json({
      audit_logs: auditLogs,
    });
  } catch (err) {
    res.status(400).json({ error: err.message }); // Send the error message if there's a failure
  }
});

//Create a Log
router.post("/add", verify, async (req, res) => {
  console.log("Log api access");
  // console.log(req.body);
  try {
    const newLog = new AuditLog({
      log_detail: req.body.log_detail,
      // data: req.body.data,
      activity: req.body.activity,
      user_id: req.user._id,
      page: req.body.page,
      ip_information: req.user.ip_information ? req.user.ip_information : null,
      page_route: req.body.page_route,
    });
    //console.log(req.data.log_detail);
    //console.log(newLog);
    const savedLog = await newLog.save();
    res.json({ message: "Logged" });
  } catch (err) {
    console.log(err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
