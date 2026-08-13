const router = require("express").Router();
const Gallery = require("../models/Gallery");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for multiple image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../public/gallery");
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "gallery-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per image
  },
  fileFilter: fileFilter,
});

// Helper to delete an uploaded image file
const deleteImageFile = (imagePath) => {
  if (!imagePath) return;
  const filePath = path.join(__dirname, "../public", imagePath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// Parse the existing_order form field (a JSON array of existing image paths)
// into an array of strings, or null when absent.
const parseOrderList = (field) => {
  if (field === undefined || field === null || field === "") return null;
  try {
    const parsed = JSON.parse(field);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
  } catch (e) {
    return null;
  }
};

// Validate that a submitted order list is a permutation of the current set.
// Returns true only when every path exists and no duplicates/omissions occur.
const isPermutation = (order, current) => {
  if (!Array.isArray(order) || !Array.isArray(current)) return false;
  if (order.length !== current.length) return false;
  const currentSet = new Set(current);
  const seen = new Set();
  for (const item of order) {
    if (!currentSet.has(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
};

// Helper to clean up files when an operation fails
const cleanupUploadedFiles = (files) => {
  if (files && files.length > 0) {
    files.forEach((file) => {
      const filePath = path.join(__dirname, "../public/gallery", file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  }
};

// (R) Read / Get All Galleries (public)
router.get("/", async (req, res) => {
  try {
    // Respect the admin-set sort_order first, then fall back to newest
    const galleries = await Gallery.find().sort({ sort_order: 1, createdAt: -1 });

    res.json({
      galleries: galleries,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (R) Read / Get Single Gallery by ID (public)
router.get("/:id", async (req, res) => {
  try {
    const gallery = await Gallery.findById(req.params.id);
    if (!gallery) {
      return res.status(404).json({ error: "Gallery not found" });
    }
    res.json({
      gallery: gallery,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (C) Create / Add a Gallery Event
router.post("/add", verify, upload.array("images", 30), async (req, res) => {
  try {
    // Prepare gallery data
    const galleryData = {
      title: req.body.title,
      description: req.body.description || "",
      images: [],
    };

    // Add image URLs if files were uploaded
    if (req.files && req.files.length > 0) {
      // Save paths without "public" prefix
      galleryData.images = req.files.map((file) => `gallery/${file.filename}`);
    }

    const gallery = new Gallery(galleryData);

    const log_id = await createLog({
      data: JSON.stringify({ ...galleryData }),
      user: req.user._id,
      activity: "Create",
      page: "Gallery",
      ip_information: req.ip,
      route: "/add",
    });

    const savedGallery = await gallery.save();
    res.json({ gallery: savedGallery._id });
  } catch (err) {
    // Delete uploaded files if there's an error
    cleanupUploadedFiles(req.files);
    res.status(400).json({ error: err.message || err });
  }
});

// (U) Update Gallery Event
router.post(
  "/update/:id",
  verify,
  upload.array("images", 30),
  async (req, res) => {
    try {
      const gallery = await Gallery.findById(req.params.id);

      if (!gallery) {
        return res.status(404).json({ message: "Gallery not found" });
      }

      // Update fields
      if (req.body.title !== undefined) gallery.title = req.body.title;
      if (req.body.description !== undefined)
        gallery.description = req.body.description;

      // If new images are uploaded, replace the existing set
      if (req.files && req.files.length > 0) {
        // Delete old images
        (gallery.images || []).forEach(deleteImageFile);
        // Save new image paths without "public" prefix
        gallery.images = req.files.map((file) => `gallery/${file.filename}`);
      } else {
        // No uploads: support drag-and-drop reordering of existing images
        // via the existing_order field (JSON array of current image paths).
        const order = parseOrderList(req.body.existing_order);
        if (order && isPermutation(order, gallery.images || [])) {
          gallery.images = order;
        }
      }

      const log_id = await createLog({
        data: JSON.stringify({ ...gallery.toObject(), ...req.body }),
        user: req.user._id,
        activity: "Update",
        page: "Gallery",
        ip_information: req.ip,
        route: "/update",
      });

      const updatedGallery = await gallery.save();
      res.json({ gallery: updatedGallery });
    } catch (err) {
      // Delete uploaded files if there's an error
      cleanupUploadedFiles(req.files);
      res.status(400).json({ error: err.message || err });
    }
  }
);

// (U2) Reorder Gallery Events (admin drag-and-drop ordering)
// Body: { order: ["id1", "id2", ...] } — the full ordered list of event IDs.
router.post("/reorder", verify, async (req, res) => {
  try {
    const order = req.body.order;
    if (!Array.isArray(order) || order.length === 0) {
      return res
        .status(400)
        .json({ error: "order must be a non-empty array of gallery IDs" });
    }

    const ids = order.map((id) => String(id).trim()).filter(Boolean);
    const galleries = await Gallery.find({ _id: { $in: ids } }).select("_id");
    const foundIds = new Set(galleries.map((g) => String(g._id)));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ error: "One or more gallery IDs do not exist", missing });
    }

    const ops = ids.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sort_order: index + 1 } },
      },
    }));
    await Gallery.bulkWrite(ops);

    const log_id = await createLog({
      data: JSON.stringify({ order: ids }),
      user: req.user._id,
      activity: "Reorder",
      page: "Gallery",
      ip_information: req.ip,
      route: "/reorder",
    });

    res.json({ message: "Gallery order updated successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message || err });
  }
});

// (D) Delete Gallery Event
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const gallery = await Gallery.findById(req.params.id);

    if (!gallery) {
      return res.status(404).json({ message: "Gallery not found" });
    }

    // Delete all gallery image files
    (gallery.images || []).forEach(deleteImageFile);

    const log_id = await createLog({
      data: JSON.stringify(gallery.toObject()),
      user: req.user._id,
      activity: "Delete",
      page: "Gallery",
      ip_information: req.ip,
      route: "/delete",
    });

    await gallery.deleteOne();
    res.json({ message: "Gallery deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting gallery", error: err });
  }
});

module.exports = router;
