const express = require("express");
const router = express.Router();
const PageContent = require("../models/PageContent");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");

const ALLOWED_PAGES = ["home", "about", "contact", "consent"];

const isValidPage = (p) => typeof p === "string" && ALLOWED_PAGES.includes(p);

// GET /api/page-content/:page — public, used by the website to render pages
router.get("/:page", async (req, res) => {
  if (!isValidPage(req.params.page)) {
    return res.status(404).json({ message: "Unknown page" });
  }
  try {
    const doc = await PageContent.findOne({ page_key: req.params.page }).lean();
    res.json({
      page_key: req.params.page,
      content: doc ? doc.content : {}, // {} → frontend falls back to defaults
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/page-content/:page — admin only, saves (upserts) page content
router.put("/:page", verify, async (req, res) => {
  if (!isValidPage(req.params.page)) {
    return res.status(404).json({ message: "Unknown page" });
  }

  const role = req.user?.role;
  if (role !== "FULL_ACCESS") {
    return res
      .status(403)
      .json({ message: "You are not authorized to edit page content" });
  }

  const { content } = req.body || {};
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return res.status(400).json({ message: "content (object) is required" });
  }

  try {
    const doc = await PageContent.findOneAndUpdate(
      { page_key: req.params.page },
      { content, updated_by: req.user._id },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    createLog({
      data: JSON.stringify({ page: req.params.page }),
      user: req.user._id,
      activity: "Update",
      page: "page-content",
      ip_information: req.ip,
      route: "/page-content",
    });

    res.json({ message: "Page content saved", page_key: doc.page_key });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
