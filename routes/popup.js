const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const Popup = require("../models/Popup");
const verify = require("./verifyToken");

// Multer storage for popup images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../public/popups");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, "popup-" + uniqueSuffix + ext);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|svg/;
  const extname = allowed.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowed.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error("Only image files (jpeg, jpg, png, gif, webp, svg) are allowed!"));
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter,
});

const deleteImageFile = (imagePath) => {
  if (!imagePath) return;
  // Strip leading slash if present
  const cleanPath = imagePath.startsWith("/") ? imagePath.slice(1) : imagePath;
  const filePath = path.join(__dirname, "../public", cleanPath);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn("Failed to unlink image file:", filePath, e.message);
    }
  }
};

// GET /api/popup/active — Public endpoint for the home page popup
router.get("/active", async (req, res) => {
  try {
    const now = new Date();
    // Look for manual isActive: true popups
    const popups = await Popup.find({ isActive: true }).sort({ updatedAt: -1 });

    // Filter by schedule date range
    const activePopup = popups.find((p) => {
      if (p.startDate && new Date(p.startDate) > now) {
        return false; // Scheduled for the future
      }
      if (p.endDate && new Date(p.endDate) < now) {
        return false; // Already expired
      }
      return true;
    });

    return res.json({
      success: true,
      popup: activePopup || null,
    });
  } catch (error) {
    console.error("Get active popup error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve active popup.",
    });
  }
});

// GET /api/popup/list — Admin endpoint to list all popups
router.get("/list", verify, async (req, res) => {
  try {
    const popups = await Popup.find().sort({ createdAt: -1 }).lean();
    const now = new Date();

    const formatted = popups.map((p) => {
      let status = "INACTIVE";
      if (p.isActive) {
        if (p.startDate && new Date(p.startDate) > now) {
          status = "SCHEDULED";
        } else if (p.endDate && new Date(p.endDate) < now) {
          status = "EXPIRED";
        } else {
          status = "ACTIVE";
        }
      } else if (p.endDate && new Date(p.endDate) < now) {
        status = "EXPIRED";
      }

      return {
        ...p,
        computedStatus: status,
      };
    });

    return res.json({
      success: true,
      popups: formatted,
    });
  } catch (error) {
    console.error("Popup list error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load popups.",
    });
  }
});

// POST /api/popup/add — Admin endpoint to create a popup
router.post("/add", verify, upload.single("image"), async (req, res) => {
  try {
    const {
      title,
      linkUrl,
      openInNewTab,
      isActive,
      startDate,
      endDate,
      displayDelaySeconds,
    } = req.body;

    if (!title || !title.trim()) {
      if (req.file) deleteImageFile(`/popups/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: "Title is required.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload an image for the popup.",
      });
    }

    const imagePath = `/popups/${req.file.filename}`;
    const activeBool = String(isActive) === "true" || isActive === true;

    // Enforce single active popup rule: if this popup is marked active,
    // deactivate all other popups immediately
    if (activeBool) {
      await Popup.updateMany({}, { isActive: false });
    }

    const popup = new Popup({
      title: title.trim(),
      image: imagePath,
      linkUrl: linkUrl ? linkUrl.trim() : "",
      openInNewTab: String(openInNewTab) === "true" || openInNewTab === true,
      isActive: activeBool,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      displayDelaySeconds: Number(displayDelaySeconds) || 1,
      createdBy: req.user?._id || null,
    });

    await popup.save();

    return res.status(201).json({
      success: true,
      message: "Popup created successfully.",
      popup,
    });
  } catch (error) {
    if (req.file) deleteImageFile(`/popups/${req.file.filename}`);
    console.error("Popup add error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create popup.",
    });
  }
});

// PUT /api/popup/update/:id — Admin endpoint to update a popup
router.put("/update/:id", verify, upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const popup = await Popup.findById(id);
    if (!popup) {
      if (req.file) deleteImageFile(`/popups/${req.file.filename}`);
      return res.status(404).json({
        success: false,
        message: "Popup not found.",
      });
    }

    const {
      title,
      linkUrl,
      openInNewTab,
      isActive,
      startDate,
      endDate,
      displayDelaySeconds,
    } = req.body;

    if (title && title.trim()) {
      popup.title = title.trim();
    }

    if (linkUrl !== undefined) {
      popup.linkUrl = linkUrl.trim();
    }

    if (openInNewTab !== undefined) {
      popup.openInNewTab =
        String(openInNewTab) === "true" || openInNewTab === true;
    }

    if (displayDelaySeconds !== undefined) {
      popup.displayDelaySeconds = Number(displayDelaySeconds) || 1;
    }

    popup.startDate = startDate ? new Date(startDate) : null;
    popup.endDate = endDate ? new Date(endDate) : null;

    const activeBool = String(isActive) === "true" || isActive === true;
    if (isActive !== undefined) {
      popup.isActive = activeBool;
      // Enforce single active popup rule
      if (activeBool) {
        await Popup.updateMany({ _id: { $ne: popup._id } }, { isActive: false });
      }
    }

    if (req.file) {
      const oldImage = popup.image;
      popup.image = `/popups/${req.file.filename}`;
      // Remove old image file
      deleteImageFile(oldImage);
    }

    await popup.save();

    return res.json({
      success: true,
      message: "Popup updated successfully.",
      popup,
    });
  } catch (error) {
    if (req.file) deleteImageFile(`/popups/${req.file.filename}`);
    console.error("Popup update error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update popup.",
    });
  }
});

// PATCH /api/popup/toggle/:id — Toggle active visibility for a popup
router.patch("/toggle/:id", verify, async (req, res) => {
  try {
    const { id } = req.params;
    const popup = await Popup.findById(id);
    if (!popup) {
      return res.status(404).json({
        success: false,
        message: "Popup not found.",
      });
    }

    const nextActive = !popup.isActive;
    popup.isActive = nextActive;

    // Enforce single active popup rule
    if (nextActive) {
      await Popup.updateMany({ _id: { $ne: popup._id } }, { isActive: false });
    }

    await popup.save();

    return res.json({
      success: true,
      message: nextActive
        ? "Popup activated (other popups disabled)."
        : "Popup deactivated.",
      popup,
    });
  } catch (error) {
    console.error("Popup toggle error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to toggle popup status.",
    });
  }
});

// DELETE /api/popup/delete/:id — Admin endpoint to delete a popup
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const { id } = req.params;
    const popup = await Popup.findById(id);
    if (!popup) {
      return res.status(404).json({
        success: false,
        message: "Popup not found.",
      });
    }

    deleteImageFile(popup.image);
    await Popup.deleteOne({ _id: id });

    return res.json({
      success: true,
      message: "Popup deleted successfully.",
    });
  } catch (error) {
    console.error("Popup delete error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete popup.",
    });
  }
});

module.exports = router;
