const router = require("express").Router();
const Executive = require("../models/Executive");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../public/profile");
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "profile-" + uniqueSuffix + path.extname(file.originalname));
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
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter,
});

// (R) Read / Get All Executives
router.get("/", async (req, res) => {
  try {
    const executives = await Executive.find()
      .sort({
        createdAt: 1,
      })
      .populate("executive_type_id");

    res.json({
      executives: executives,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (R) Read / Get Single Executive by ID
router.get("/:id", verify, async (req, res) => {
  try {
    const executives = await Executive.findById(req.params.id);
    if (!executives) {
      return res.status(404).json({ error: "Executives not found" });
    }
    res.json({
      executives: executives,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (C) Create / Add an Executive
router.post(
  "/add",
  verify,
  upload.single("profile_picture"),
  async (req, res) => {
    try {
      // Prepare executive data
      const executiveData = {
        profile_name: req.body.profile_name,
        executive_type_id: req.body.executive_type_id,
        profile_designation: req.body.profile_designation,
        profile_description: req.body.profile_description,
        profile_email: req.body.profile_email,
        profile_phone: req.body.profile_phone,
        profile_linkedin: req.body.profile_linkedin,
        profile_twitter: req.body.profile_twitter,
        profile_facebook: req.body.profile_facebook,
        profile_instagram: req.body.profile_instagram,
        profile_youtube: req.body.profile_youtube,
      };

      // Add profile picture URL if file was uploaded
      if (req.file) {
        // Save path without "public" prefix
        executiveData.profile_picture_url = `profile/${req.file.filename}`;
      }

      const executive = new Executive(executiveData);

      const log_id = await createLog({
        data: JSON.stringify({ ...executiveData }),
        user: req.user._id,
        activity: "Create",
        page: "BoardMember",
        ip_information: req.ip,
        route: "/add",
      });

      const savedExecutive = await executive.save();
      res.json({ executive: savedExecutive._id });
    } catch (err) {
      // Delete uploaded file if there's an error
      if (req.file) {
        const filePath = path.join(
          __dirname,
          "../public/profile",
          req.file.filename
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      res.status(400).json({ error: err.message || err });
    }
  }
);

// (U) Update Executive
router.post(
  "/update/:id",
  verify,
  upload.single("profile_picture"),
  async (req, res) => {
    try {
      const executive = await Executive.findById(req.params.id);

      if (!executive) {
        return res.status(404).json({ message: "Executive not found" });
      }

      // Update fields
      if (req.body.profile_name !== undefined)
        executive.profile_name = req.body.profile_name;
      if (req.body.executive_type_id !== undefined)
        executive.executive_type_id = req.body.executive_type_id;
      if (req.body.profile_designation !== undefined)
        executive.profile_designation = req.body.profile_designation;
      if (req.body.profile_description !== undefined)
        executive.profile_description = req.body.profile_description;
      if (req.body.profile_email !== undefined)
        executive.profile_email = req.body.profile_email;
      if (req.body.profile_phone !== undefined)
        executive.profile_phone = req.body.profile_phone;
      if (req.body.profile_linkedin !== undefined)
        executive.profile_linkedin = req.body.profile_linkedin;
      if (req.body.profile_twitter !== undefined)
        executive.profile_twitter = req.body.profile_twitter;
      if (req.body.profile_facebook !== undefined)
        executive.profile_facebook = req.body.profile_facebook;
      if (req.body.profile_instagram !== undefined)
        executive.profile_instagram = req.body.profile_instagram;
      if (req.body.profile_youtube !== undefined)
        executive.profile_youtube = req.body.profile_youtube;

      // Handle new profile picture upload
      if (req.file) {
        // Delete old profile picture if it exists
        if (executive.profile_picture_url) {
          const oldFilePath = path.join(
            __dirname,
            "../public",
            executive.profile_picture_url
          );
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
          }
        }
        // Save new profile picture path without "public" prefix
        executive.profile_picture_url = `profile/${req.file.filename}`;
      }

      const log_id = await createLog({
        data: JSON.stringify({ ...executive.toObject(), ...req.body }),
        user: req.user._id,
        activity: "Update",
        page: "BoardMember",
        ip_information: req.ip,
        route: "/update",
      });

      const updatedExecutive = await executive.save();
      res.json({ executive: updatedExecutive });
    } catch (err) {
      // Delete uploaded file if there's an error
      if (req.file) {
        const filePath = path.join(
          __dirname,
          "../public/profile",
          req.file.filename
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      res.status(400).json({ error: err.message || err });
    }
  }
);

// (D) Delete Executive
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const executive = await Executive.findById(req.params.id);

    if (!executive) {
      return res.status(404).json({ message: "Executive not found" });
    }

    // Delete profile picture file if it exists
    if (executive.profile_picture_url) {
      const filePath = path.join(
        __dirname,
        "../public",
        executive.profile_picture_url
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    const log_id = await createLog({
      data: JSON.stringify(executive.toObject()),
      user: req.user._id,
      activity: "Delete",
      page: "Executive",
      ip_information: req.ip,
      route: "/delete",
    });

    await executive.deleteOne();
    res.json({ message: "Executive deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting executive", error: err });
  }
});

module.exports = router;
