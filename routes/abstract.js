const router = require("express").Router();
const Abstract = require("../models/Abstract");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");

// (R) Read / Get all abstracts (public)
router.get("/", async (req, res) => {
  try {
    const abstracts = await Abstract.find().sort({
      sort_order: 1,
      year: -1,
      createdAt: 1,
    });
    res.json({ abstracts });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (R) Read / Get single abstract by ID (public)
router.get("/:id", async (req, res) => {
  try {
    const item = await Abstract.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Abstract page not found" });
    }
    res.json({ abstract: item });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (C) Create abstract
router.post("/add", verify, async (req, res) => {
  try {
    const title = (req.body.title || "").toString().trim();
    const year = Number(req.body.year);

    if (!title) {
      return res.status(400).json({ error: "Abstract title is required" });
    }
    if (!Number.isFinite(year) || year < 2000) {
      return res.status(400).json({ error: "A valid year is required" });
    }

    const item = new Abstract({
      title,
      year,
      description: (req.body.description || "").toString().trim(),
      content: (req.body.content || "").toString(),
      sort_order: Number(req.body.sort_order) || 0,
    });

    await createLog({
      data: JSON.stringify(item.toObject()),
      user: req.user._id,
      activity: "Create",
      page: "Abstract",
      ip_information: req.ip,
      route: "/add",
    });

    const saved = await item.save();
    res.json({ abstract: saved._id });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (U) Update abstract
router.post("/update/:id", verify, async (req, res) => {
  try {
    const item = await Abstract.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: "Abstract not found" });
    }

    if (req.body.title !== undefined)
      item.title = (req.body.title || "").toString().trim();
    if (req.body.year !== undefined) item.year = Number(req.body.year);
    if (req.body.description !== undefined)
      item.description = (req.body.description || "").toString().trim();
    if (req.body.content !== undefined)
      item.content = (req.body.content || "").toString();
    if (req.body.sort_order !== undefined)
      item.sort_order = Number(req.body.sort_order) || 0;

    await createLog({
      data: JSON.stringify(item.toObject()),
      user: req.user._id,
      activity: "Update",
      page: "Abstract",
      ip_information: req.ip,
      route: "/update",
    });

    const updated = await item.save();
    res.json({ abstract: updated._id });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (D) Delete abstract
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const item = await Abstract.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: "Abstract not found" });
    }

    await createLog({
      data: JSON.stringify(item.toObject()),
      user: req.user._id,
      activity: "Delete",
      page: "Abstract",
      ip_information: req.ip,
      route: "/delete",
    });

    await item.deleteOne();
    res.json({ message: "Abstract deleted successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

module.exports = router;
