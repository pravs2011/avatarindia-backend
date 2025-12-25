const router = require("express").Router();
const BoardMember = require("../models/BoardMember");
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

// (R) Read / Get All Board Members
router.get("/", verify, async (req, res) => {
  try {
    const boardMembers = await BoardMember.find().sort({
      createdAt: -1,
    });
    res.json({
      boardMembers: boardMembers,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (R) Read / Get Single Board Member by ID
router.get("/:id", verify, async (req, res) => {
  try {
    const boardMembers = await BoardMember.findById(req.params.id);
    if (!boardMembers) {
      return res.status(404).json({ error: "Board members not found" });
    }
    res.json({
      boardMembers: boardMembers,
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
});

// (C) Create / Add a Board Member
router.post(
  "/add",
  verify,
  upload.single("profile_picture"),
  async (req, res) => {
    try {
      // Prepare board member data
      const boardMemberData = {
        profile_name: req.body.profile_name,
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
        boardMemberData.profile_picture_url = `profile/${req.file.filename}`;
      }

      const boardMember = new BoardMember(boardMemberData);

      const log_id = await createLog({
        data: JSON.stringify({ ...boardMemberData }),
        user: req.user._id,
        activity: "Create",
        page: "BoardMember",
        ip_information: req.ip,
        route: "/add",
      });

      const savedBoardMember = await boardMember.save();
      res.json({ boardMember: savedBoardMember._id });
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

// (U) Update Board Member
router.post(
  "/update/:id",
  verify,
  upload.single("profile_picture"),
  async (req, res) => {
    try {
      const boardMember = await BoardMember.findById(req.params.id);

      if (!boardMember) {
        return res.status(404).json({ message: "Board member not found" });
      }

      // Update fields
      if (req.body.profile_name !== undefined)
        boardMember.profile_name = req.body.profile_name;
      if (req.body.profile_designation !== undefined)
        boardMember.profile_designation = req.body.profile_designation;
      if (req.body.profile_description !== undefined)
        boardMember.profile_description = req.body.profile_description;
      if (req.body.profile_email !== undefined)
        boardMember.profile_email = req.body.profile_email;
      if (req.body.profile_phone !== undefined)
        boardMember.profile_phone = req.body.profile_phone;
      if (req.body.profile_linkedin !== undefined)
        boardMember.profile_linkedin = req.body.profile_linkedin;
      if (req.body.profile_twitter !== undefined)
        boardMember.profile_twitter = req.body.profile_twitter;
      if (req.body.profile_facebook !== undefined)
        boardMember.profile_facebook = req.body.profile_facebook;
      if (req.body.profile_instagram !== undefined)
        boardMember.profile_instagram = req.body.profile_instagram;
      if (req.body.profile_youtube !== undefined)
        boardMember.profile_youtube = req.body.profile_youtube;

      // Handle new profile picture upload
      if (req.file) {
        // Delete old profile picture if it exists
        if (boardMember.profile_picture_url) {
          const oldFilePath = path.join(
            __dirname,
            "../public",
            boardMember.profile_picture_url
          );
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
          }
        }
        // Save new profile picture path without "public" prefix
        boardMember.profile_picture_url = `profile/${req.file.filename}`;
      }

      const log_id = await createLog({
        data: JSON.stringify({ ...boardMember.toObject(), ...req.body }),
        user: req.user._id,
        activity: "Update",
        page: "BoardMember",
        ip_information: req.ip,
        route: "/update",
      });

      const updatedBoardMember = await boardMember.save();
      res.json({ boardMember: updatedBoardMember });
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

// (D) Delete Board Member
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const boardMember = await BoardMember.findById(req.params.id);

    if (!boardMember) {
      return res.status(404).json({ message: "Board member not found" });
    }

    // Delete profile picture file if it exists
    if (boardMember.profile_picture_url) {
      const filePath = path.join(
        __dirname,
        "../public",
        boardMember.profile_picture_url
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    const log_id = await createLog({
      data: JSON.stringify(boardMember.toObject()),
      user: req.user._id,
      activity: "Delete",
      page: "BoardMember",
      ip_information: req.ip,
      route: "/delete",
    });

    await boardMember.deleteOne();
    res.json({ message: "Board member deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error deleting board member", error: err });
  }
});

module.exports = router;
