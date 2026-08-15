const express = require("express");
const router = express.Router();
const Grievance = require("../models/Grievance");
const Registration = require("../models/Registration");
const verify = require("./verifyToken");
const verifyMembershipToken = require("../middleware/memberAuth");
const { createNotification } = require("./notifications");

const VALID_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"];

// Append a message to a grievance's discussion thread.
const appendMessage = (grievance, authorType, author, text) => {
  const clean = String(text || "").trim();
  if (!clean) return false;

  // Migrate a legacy single adminNote into the thread so it is never lost.
  if (grievance.adminNote) {
    grievance.messages.push({
      authorType: "ADMIN",
      author: "Admin",
      text: grievance.adminNote,
      createdAt: grievance.updatedAt || new Date(),
    });
    grievance.adminNote = "";
  }

  grievance.messages.push({
    authorType,
    author,
    text: clean,
    createdAt: new Date(),
  });
  return true;
};

// Build the serialized grievance shape (thread + legacy fallback).
const serializeGrievance = (grievance) => {
  const g = grievance.toObject ? grievance.toObject() : grievance;
  let messages = Array.isArray(g.messages) ? g.messages : [];

  // Legacy records: surface the old adminNote as an admin message.
  if (messages.length === 0 && g.adminNote) {
    messages = [
      {
        authorType: "ADMIN",
        author: "Admin",
        text: g.adminNote,
        createdAt: g.updatedAt || g.createdAt || new Date(),
      },
    ];
  }

  return { ...g, messages };
};

// POST / - a logged-in member submits a grievance
router.post("/", verifyMembershipToken, async (req, res) => {
  try {
    const category = String(req.body.category || "Other").trim();
    const subject = String(req.body.subject || "").trim();
    const description = String(req.body.description || "").trim();

    if (!subject || !description) {
      return res.status(400).json({
        success: false,
        message: "Subject and description are required.",
      });
    }

    const member = await Registration.findById(req.member._id);
    const grievance = new Grievance({
      memberId: req.member._id,
      registrationNo: member ? member.registrationNo : "",
      memberName: member ? member.fullName : "",
      memberEmail: member ? member.email : "",
      category,
      subject,
      description,
      status: "OPEN",
    });
    await grievance.save();

    await createNotification({
      type: "GRIEVANCE",
      message: `New grievance from ${grievance.memberName || grievance.memberEmail} (${grievance.registrationNo}): ${grievance.subject}`,
      registrationNo: grievance.registrationNo,
      memberName: grievance.memberName,
      memberEmail: grievance.memberEmail,
    });

    return res.status(201).json({
      success: true,
      message: "Grievance submitted successfully.",
      grievance,
    });
  } catch (error) {
    console.error("Grievance submit error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to submit grievance.",
    });
  }
});

// GET /my - the logged-in member's own grievances
router.get("/my", verifyMembershipToken, async (req, res) => {
  try {
    const grievances = await Grievance.find({ memberId: req.member._id }).sort({
      createdAt: -1,
    });
    return res.json({
      success: true,
      grievances: grievances.map(serializeGrievance),
    });
  } catch (error) {
    console.error("Grievance my-list error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch grievances.",
    });
  }
});

// POST /:id/reply - the owning member adds a follow-up to the thread
router.post("/:id/reply", verifyMembershipToken, async (req, res) => {
  try {
    const grievance = await Grievance.findById(req.params.id);
    if (!grievance) {
      return res.status(404).json({
        success: false,
        message: "Grievance not found.",
      });
    }

    if (String(grievance.memberId) !== String(req.member._id)) {
      return res.status(403).json({
        success: false,
        message: "You can only reply to your own grievances.",
      });
    }

    const member = await Registration.findById(req.member._id);
    const appended = appendMessage(
      grievance,
      "MEMBER",
      member ? member.fullName || member.email : req.member.email,
      req.body.message,
    );
    if (!appended) {
      return res.status(400).json({
        success: false,
        message: "Reply message is required.",
      });
    }

    await grievance.save();

    await createNotification({
      type: "GRIEVANCE",
      message: `New reply from ${grievance.memberName || grievance.memberEmail} on grievance (${grievance.registrationNo}): ${grievance.subject}`,
      registrationNo: grievance.registrationNo,
      memberName: grievance.memberName,
      memberEmail: grievance.memberEmail,
    });

    return res.json({
      success: true,
      message: "Reply added.",
      grievance: serializeGrievance(grievance),
    });
  } catch (error) {
    console.error("Grievance reply error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to add reply.",
    });
  }
});

// GET / - admin: all grievances (optional status filter)
router.get("/", verify, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status && VALID_STATUSES.includes(status) ? { status } : {};
    const grievances = await Grievance.find(filter).sort({ createdAt: -1 });
    return res.json({
      success: true,
      grievances: grievances.map(serializeGrievance),
    });
  } catch (error) {
    console.error("Grievance list error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch grievances.",
    });
  }
});

// POST /:id/status - admin updates a grievance's status and/or note
router.post("/:id/status", verify, async (req, res) => {
  try {
    const grievance = await Grievance.findById(req.params.id);
    if (!grievance) {
      return res.status(404).json({
        success: false,
        message: "Grievance not found.",
      });
    }

    const { status, response, adminNote } = req.body;
    if (status && VALID_STATUSES.includes(status)) {
      grievance.status = status;
      if (status === "RESOLVED" || status === "REJECTED") {
        grievance.resolvedAt = new Date();
        grievance.resolvedBy = req.user._id;
      } else {
        grievance.resolvedAt = null;
        grievance.resolvedBy = null;
      }
    }

    // Keep the discussion intact: every admin response is appended to the
    // thread instead of replacing the previous one. `adminNote` is accepted
    // as a legacy alias for `response`.
    const responseText = response ?? adminNote;
    if (responseText !== undefined) {
      appendMessage(
        grievance,
        "ADMIN",
        `Admin: ${req.user.name || "Unknown"}`,
        responseText,
      );
    }

    await grievance.save();

    // Let the member know there is an incoming message / status change
    if (grievance.memberId) {
      await createNotification({
        type: "GRIEVANCE",
        message: responseText
          ? `New response on your grievance (${grievance.registrationNo}): ${grievance.subject}`
          : `Your grievance status was updated to ${grievance.status} (${grievance.registrationNo}): ${grievance.subject}`,
        registrationNo: grievance.registrationNo,
        memberName: grievance.memberName,
        memberEmail: grievance.memberEmail,
        audience: "MEMBER",
        memberId: grievance.memberId,
      });
    }

    return res.json({
      success: true,
      message: "Grievance updated.",
      grievance: serializeGrievance(grievance),
    });
  } catch (error) {
    console.error("Grievance update error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update grievance.",
    });
  }
});

module.exports = router;
