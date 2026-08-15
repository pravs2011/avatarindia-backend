const router = require("express").Router();
const Committee = require("../models/Committee");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const COMMITTEE_UPLOAD_DIR = path.join(__dirname, "../public/committee");

// Ensure upload directory exists
if (!fs.existsSync(COMMITTEE_UPLOAD_DIR)) {
  fs.mkdirSync(COMMITTEE_UPLOAD_DIR, { recursive: true });
}

// Decode a base64 data-URL (data:image/...;base64,....) into a buffer.
// Returns null when the string is not a valid image data URL.
const decodeDataUrl = (str) => {
  if (typeof str !== "string") return null;
  const match = String(str).match(
    /^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/i,
  );
  if (!match) return null;
  const ext =
    match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer || buffer.length === 0) return null;
    return { ext, buffer };
  } catch (e) {
    return null;
  }
};

// Walk a committee's sections and collect every stored photo path
const collectPhotoPaths = (committee) => {
  const paths = [];
  (committee.sections || []).forEach((section) => {
    (section.members || []).forEach((member) => {
      if (member.photo && !String(member.photo).startsWith("data:")) {
        paths.push(member.photo);
      }
    });
  });
  return paths;
};

// Delete a photo file referenced by a stored path (e.g. "committee/abc.jpg")
const deleteStoredPhoto = (photoPath) => {
  if (!photoPath || String(photoPath).startsWith("data:")) return;
  const filePath = path.join(__dirname, "../public", photoPath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// Clean uploaded data-URL photos when the whole operation fails
const cleanupFiles = (files) => {
  (files || []).forEach((f) => {
    if (fs.existsSync(f.fullPath)) {
      fs.unlinkSync(f.fullPath);
    }
  });
};

// Normalize a committee document:
//  - validate section/member shapes
//  - persist new data-URL photos to disk (returns { normalized, savedFiles, error })
const normalizeCommittee = (raw, existing) => {
  const savedFiles = [];
  const rawSections = Array.isArray(raw) ? raw : [];
  const sections = rawSections.map((section) => {
    const rawMembers = Array.isArray(section.members) ? section.members : [];
    const members = rawMembers.map((member) => {
      let photo = member.photo || "";
      if (typeof photo === "string" && photo.startsWith("data:image")) {
        const decoded = decodeDataUrl(photo);
        if (!decoded) {
          throw new Error("A member photo is not a valid image data URL");
        }
        const filename =
          "committee-" +
          Date.now() +
          "-" +
          crypto.randomBytes(8).toString("hex") +
          "." +
          decoded.ext;
        const fullPath = path.join(COMMITTEE_UPLOAD_DIR, filename);
        fs.writeFileSync(fullPath, decoded.buffer);
        savedFiles.push({ fullPath, storedPath: `committee/${filename}` });
        photo = `committee/${filename}`;
      }
      return {
        name: (member.name || "").toString().trim(),
        designation: (member.designation || "").toString().trim(),
        info: (member.info || "").toString().trim(),
        photo,
      };
    });
    return {
      title: (section.title || "").toString().trim(),
      subtitle: (section.subtitle || "").toString().trim(),
      members,
    };
  });

  // Delete photos that are no longer referenced (removed members/edits)
  if (existing) {
    const oldPaths = collectPhotoPaths(existing);
    const newPaths = new Set(
      sections.flatMap((s) => s.members.map((m) => m.photo)),
    );
    oldPaths.forEach((p) => {
      if (p && !newPaths.has(p)) {
        deleteStoredPhoto(p);
      }
    });
  }

  return { sections, savedFiles };
};

// (R) Read / Get All Committees (public — used by header submenu + public pages)
router.get("/", async (req, res) => {
  try {
    const committees = await Committee.find().sort({
      sort_order: 1,
      createdAt: 1,
    });
    res.json({ committees });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (R) Read / Get Single Committee by ID (public)
router.get("/:id", async (req, res) => {
  try {
    const committee = await Committee.findById(req.params.id);
    if (!committee) {
      return res.status(404).json({ error: "Committee not found" });
    }
    res.json({ committee });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (C) Create / Add a Committee
router.post("/add", verify, async (req, res) => {
  const savedFiles = [];
  try {
    const rawSections =
      typeof req.body.sections === "string"
        ? JSON.parse(req.body.sections)
        : req.body.sections;
    const normalized = normalizeCommittee(rawSections, null);
    savedFiles.push(...normalized.savedFiles);

    const committee = new Committee({
      name: (req.body.name || "").toString().trim(),
      description: (req.body.description || "").toString().trim(),
      sections: normalized.sections,
      sort_order: Number(req.body.sort_order) || 0,
    });

    await createLog({
      data: JSON.stringify(committee.toObject()),
      user: req.user._id,
      activity: "Create",
      page: "Committee",
      ip_information: req.ip,
      route: "/add",
    });

    const savedCommittee = await committee.save();
    res.json({ committee: savedCommittee._id });
  } catch (err) {
    cleanupFiles(savedFiles);
    res.status(400).json({ error: err.message || err });
  }
});

// (U) Update a Committee
router.post("/update/:id", verify, async (req, res) => {
  const savedFiles = [];
  try {
    const committee = await Committee.findById(req.params.id);
    if (!committee) {
      return res.status(404).json({ message: "Committee not found" });
    }

    if (req.body.name !== undefined)
      committee.name = (req.body.name || "").toString().trim();
    if (req.body.description !== undefined)
      committee.description = (req.body.description || "").toString().trim();
    if (req.body.sort_order !== undefined)
      committee.sort_order = Number(req.body.sort_order) || 0;

    if (req.body.sections !== undefined) {
      const rawSections =
        typeof req.body.sections === "string"
          ? JSON.parse(req.body.sections)
          : req.body.sections;
      const normalized = normalizeCommittee(rawSections, committee);
      savedFiles.push(...normalized.savedFiles);
      committee.sections = normalized.sections;
    }

    await createLog({
      data: JSON.stringify(committee.toObject()),
      user: req.user._id,
      activity: "Update",
      page: "Committee",
      ip_information: req.ip,
      route: "/update",
    });

    const updatedCommittee = await committee.save();
    res.json({ committee: updatedCommittee._id });
  } catch (err) {
    cleanupFiles(savedFiles);
    res.status(400).json({ error: err.message || err });
  }
});

// (U2) Reorder Committees for the public menu (drag-and-drop order)
router.post("/reorder", verify, async (req, res) => {
  try {
    const order = req.body.order;
    if (!Array.isArray(order) || order.length === 0) {
      return res
        .status(400)
        .json({ error: "order must be a non-empty array of committee IDs" });
    }

    const ids = order.map((id) => String(id).trim()).filter(Boolean);
    const committees = await Committee.find({ _id: { $in: ids } }).select(
      "_id",
    );
    const foundIds = new Set(committees.map((c) => String(c._id)));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ error: "One or more committee IDs do not exist", missing });
    }

    const ops = ids.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sort_order: index + 1 } },
      },
    }));
    await Committee.bulkWrite(ops);

    await createLog({
      data: JSON.stringify({ order: ids }),
      user: req.user._id,
      activity: "Reorder",
      page: "Committee",
      ip_information: req.ip,
      route: "/reorder",
    });

    res.json({ message: "Committee order updated successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (D) Delete a Committee
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const committee = await Committee.findById(req.params.id);
    if (!committee) {
      return res.status(404).json({ message: "Committee not found" });
    }

    // Delete all stored member photos
    collectPhotoPaths(committee).forEach(deleteStoredPhoto);

    await createLog({
      data: JSON.stringify(committee.toObject()),
      user: req.user._id,
      activity: "Delete",
      page: "Committee",
      ip_information: req.ip,
      route: "/delete",
    });

    await committee.deleteOne();
    res.json({ message: "Committee deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting committee", error: err });
  }
});

module.exports = router;
