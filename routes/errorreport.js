const router = require("express").Router();
const ErrorReport = require("../models/ErrorReport");
const verify = require("./verifyToken");

//(C) Create / Add a Role
router.post("/add", verify, async (req, res) => {
  const erReport = new ErrorReport({
    error_log: req.body.error_log,
    user_id: req.user._id,
    page: req.body.page,
    page_route: req.body.route,
  });

  //console.log(req.body);

  try {
    const savedErReport = await erReport.save();
    res.send({ error_log: erReport._id });
  } catch (err) {
    res.status(400).send(err);
  }
});

//(R) Read / Get All Roles
router.get("/", verify, async (req, res) => {
  try {
    const erLogs = await ErrorReport.find()
      .sort({
        createdAt: -1,
      })
      .limit(1000) // Limit the results to the last 1000 records
      .populate("user_id");
    res.json({
      error_logs: erLogs,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

//(U) Update Error logs
router.patch("/update/", verify, async (req, res) => {
  const checkRecord = await ErrorReport.findById(req.body.er_id);
  if (!checkRecord)
    return res.status(400).send({ message: "Record Doesnt Exists" });
  checkRecord.resolution_status = true;
  checkRecord.resolved_by = req.user._id;
  try {
    const savedEmr = await checkRecord.save();
    res.send({ emr: checkRecord._id });
  } catch (err) {
    res.status(400).send(JSON.stringify(err));
  }
});

module.exports = router;
