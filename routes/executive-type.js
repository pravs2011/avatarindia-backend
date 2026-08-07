const router = require("express").Router();
const ExecutiveType = require("../models/ExecutiveType");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");

// (R) Read / Get All Executive Types
router.get("/", verify, async (req, res) => {
  try {
    const executiveTypes = await ExecutiveType.find().sort({
      createdAt: -1,
    });
    res.json({
      executiveTypes: executiveTypes,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (R) Read / Get Single Executive Type by ID
router.get("/:id", verify, async (req, res) => {
  try {
    const executiveType = await ExecutiveType.findById(req.params.id);
    if (!executiveType) {
      return res.status(404).json({ error: "Executive type not found" });
    }
    res.json({
      executiveType: executiveType,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (C) Create / Add an Executive Type
router.post("/add", verify, async (req, res) => {
  try {
    const executiveType = new ExecutiveType({
      executive_type: req.body.executive_type,
      executive_type_description: req.body.executive_type_description,
    });

    const log_id = await createLog({
      data: JSON.stringify({ ...req.body }),
      user: req.user._id,
      activity: "Create",
      page: "ExecutiveType",
      ip_information: req.ip,
      route: "/add",
    });

    const savedExecutiveType = await executiveType.save();
    res.json({ executiveType: savedExecutiveType._id });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (U) Update Executive Type
router.post("/update/:id", verify, async (req, res) => {
  try {
    const executiveType = await ExecutiveType.findById(req.params.id);

    if (!executiveType) {
      return res.status(404).json({ message: "Executive type not found" });
    }

    // Update fields
    if (req.body.executive_type !== undefined)
      executiveType.executive_type = req.body.executive_type;
    if (req.body.executive_type_description !== undefined)
      executiveType.executive_type_description =
        req.body.executive_type_description;

    const log_id = await createLog({
      data: JSON.stringify({ ...executiveType.toObject(), ...req.body }),
      user: req.user._id,
      activity: "Update",
      page: "ExecutiveType",
      ip_information: req.ip,
      route: "/update",
    });

    const updatedExecutiveType = await executiveType.save();
    res.json({ executiveType: updatedExecutiveType });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (D) Delete Executive Type
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const executiveType = await ExecutiveType.findById(req.params.id);

    if (!executiveType) {
      return res.status(404).json({ message: "Executive type not found" });
    }

    const log_id = await createLog({
      data: JSON.stringify(executiveType.toObject()),
      user: req.user._id,
      activity: "Delete",
      page: "ExecutiveType",
      ip_information: req.ip,
      route: "/delete",
    });

    await executiveType.deleteOne();
    res.json({ message: "Executive type deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error deleting executive type", error: err });
  }
});

module.exports = router;
