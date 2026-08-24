const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Document = require("../models/Document");
const Registration = require("../models/Registration");
const verify = require("./verifyToken");
const verifyMembershipToken = require("../middleware/memberAuth");

const JWT_SECRET = process.env.JWT_TOKEN_SECRET || "avatarindia-local-secret";

// Multer disk storage - uploads land in backend/public/documents
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../public/documents");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, "doc-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Accept either an admin token (req.user) or a member token (req.member).
const anyAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : req.query.token || "";

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === "MEMBER") {
      req.member = decoded;
    } else {
      req.user = decoded;
    }
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Session expired or invalid.",
    });
  }
};

const deleteFile = (filePath) => {
  if (!filePath) return;
  const full = path.join(__dirname, "../public", filePath);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
  }
};

const serialize = (doc) => ({
  _id: doc._id,
  title: doc.title,
  description: doc.description,
  visibility: doc.visibility,
  fileName: doc.fileName,
  fileSize: doc.fileSize,
  mimeType: doc.mimeType,
  memberId: doc.memberId,
  registrationNo: doc.registrationNo,
  memberName: doc.memberName,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const CONSTITUTION_TITLE = "Constitution";

// Public inline viewer for the current Constitution PDF.
router.get("/constitution/view", async (req, res) => {
  try {
    const doc = await Document.findOne({
      title: CONSTITUTION_TITLE,
      visibility: "PUBLIC",
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "The Constitution document is not available yet.",
      });
    }

    const full = path.join(__dirname, "../public", doc.filePath);
    if (!fs.existsSync(full)) {
      return res.status(404).json({
        success: false,
        message: "The Constitution file is missing on the server.",
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");
    return fs.createReadStream(full).pipe(res);
  } catch (error) {
    console.error("Constitution viewer error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load the Constitution document.",
    });
  }
});

// Admin status for the Constitution document.
router.get("/constitution", verify, async (req, res) => {
  const doc = await Document.findOne({ title: CONSTITUTION_TITLE })
    .sort({ createdAt: -1 })
    .lean();
  return res.json({ success: true, document: doc ? serialize(doc) : null });
});

// Admin upload/replacement for the single public Constitution PDF.
router.post(
  "/constitution/upload",
  verify,
  upload.single("file"),
  async (req, res) => {
    try {
      const isPdf =
        req.file &&
        (req.file.mimetype === "application/pdf" || /\.pdf$/i.test(req.file.originalname || ""));
      if (!isPdf) {
        if (req.file) deleteFile(`documents/${req.file.filename}`);
        return res.status(400).json({
          success: false,
          message: "Please upload a PDF document.",
        });
      }

      const previous = await Document.find({ title: CONSTITUTION_TITLE });
      const saved = await new Document({
        title: CONSTITUTION_TITLE,
        description: "Public Constitution document",
        visibility: "PUBLIC",
        filePath: `documents/${req.file.filename}`,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: "application/pdf",
        uploadedBy: req.user._id,
      }).save();

      await Document.deleteMany({
        title: CONSTITUTION_TITLE,
        _id: { $ne: saved._id },
      });
      previous
        .filter((doc) => String(doc._id) !== String(saved._id))
        .forEach((doc) => deleteFile(doc.filePath));

      return res.status(201).json({
        success: true,
        message: "Constitution PDF uploaded successfully.",
        document: serialize(saved.toObject()),
      });
    } catch (error) {
      if (req.file) deleteFile(`documents/${req.file.filename}`);
      console.error("Constitution upload error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to upload the Constitution PDF.",
      });
    }
  },
);

// GET /api/documents - admin: list every uploaded document
router.get("/", verify, async (req, res) => {
  try {
    const docs = await Document.find().sort({ createdAt: -1 }).lean();
    return res.json({
      success: true,
      documents: docs.map(serialize),
    });
  } catch (error) {
    console.error("Documents list error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load documents.",
    });
  }
});

// POST /api/documents/add - admin: upload a public or member-private document
router.post("/add", verify, upload.single("file"), async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Document title is required.",
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please attach a file to upload.",
      });
    }

    const visibility =
      String(req.body.visibility || "PUBLIC").toUpperCase() === "PRIVATE"
        ? "PRIVATE"
        : "PUBLIC";

    let memberId = null;
    let registrationNo = "";
    let memberName = "";
    if (visibility === "PRIVATE") {
      const memberRegNo = String(req.body.memberId || "").trim();
      if (!memberRegNo) {
        deleteFile(`documents/${req.file.filename}`);
        return res.status(400).json({
          success: false,
          message: "Select the member this document is intended for.",
        });
      }
      // Accept a registration number (e.g. AIS0181) as the target member
      const member = await Registration.findOne({
        registrationNo: memberRegNo,
      }).lean();
      if (!member) {
        deleteFile(`documents/${req.file.filename}`);
        return res.status(404).json({
          success: false,
          message: "Member not found for the given registration number.",
        });
      }
      memberId = member._id;
      registrationNo = member.registrationNo;
      memberName = member.fullName;
    }

    const doc = new Document({
      title,
      description: String(req.body.description || "").trim(),
      visibility,
      filePath: `documents/${req.file.filename}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      memberId,
      registrationNo,
      memberName,
      uploadedBy: req.user._id,
    });
    const saved = await doc.save();

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully.",
      document: serialize(saved.toObject()),
    });
  } catch (error) {
    if (req.file) deleteFile(`documents/${req.file.filename}`);
    console.error("Document upload error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to upload document.",
    });
  }
});

// GET /api/documents/member - member: documents they are allowed to see
router.get("/member", verifyMembershipToken, async (req, res) => {
  try {
    const docs = await Document.find({
      $or: [
        { visibility: "PUBLIC" },
        { visibility: "PRIVATE", memberId: req.member._id },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      documents: docs.map(serialize),
    });
  } catch (error) {
    console.error("Member documents list error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load documents.",
    });
  }
});

// GET /api/documents/download/:id - admin or the intended member
router.get("/download/:id", anyAuth, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id).lean();
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Document not found.",
      });
    }

    // Permission: admins can download anything; members only public or own
    if (!req.user) {
      const isPublic = doc.visibility === "PUBLIC";
      const isOwn = String(doc.memberId || "") === String(req.member?._id || "");
      if (!isPublic && !isOwn) {
        return res.status(403).json({
          success: false,
          message: "This document is not available to you.",
        });
      }
    }

    const full = path.join(__dirname, "../public", doc.filePath);
    if (!fs.existsSync(full)) {
      return res.status(404).json({
        success: false,
        message: "Document file is missing on the server.",
      });
    }

    const safeName = (doc.fileName || "document").replace(/["\\]/g, "_");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(safeName)}"`,
    );
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("X-File-Name", encodeURIComponent(safeName));
    return fs.createReadStream(full).pipe(res);
  } catch (error) {
    console.error("Document download error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to download document.",
    });
  }
});

// DELETE /api/documents/delete/:id - admin
router.delete("/delete/:id", verify, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Document not found.",
      });
    }
    deleteFile(doc.filePath);
    await doc.deleteOne();
    return res.json({
      success: true,
      message: "Document deleted successfully.",
    });
  } catch (error) {
    console.error("Document delete error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete document.",
    });
  }
});

module.exports = router;
