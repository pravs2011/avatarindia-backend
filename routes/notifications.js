const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const verify = require("./verifyToken");
const verifyMembershipToken = require("../middleware/memberAuth");

// Legacy notifications (created before audience existed) have no audience
// field; treat them as admin notifications.
const ADMIN_FILTER = { audience: { $in: [null, "ADMIN"] } };

// Create a notification (used by other modules). Never throws - failures are
// logged and swallowed so the caller's flow is never interrupted.
// audience: "ADMIN" (default) or "MEMBER" (requires memberId).
const createNotification = async ({
  type,
  message,
  registrationNo,
  memberName,
  memberEmail,
  audience = "ADMIN",
  memberId = null,
}) => {
  try {
    const notification = new Notification({
      type,
      message,
      registrationNo: registrationNo || "",
      memberName: memberName || "",
      memberEmail: memberEmail || "",
      audience,
      memberId,
    });
    const saved = await notification.save();
    return saved;
  } catch (error) {
    console.error("Notification create error:", error.message);
    return null;
  }
};

const serializeNotification = (n, adminId) => ({
  _id: n._id,
  type: n.type,
  message: n.message,
  registrationNo: n.registrationNo,
  memberName: n.memberName,
  memberEmail: n.memberEmail,
  read: adminId
    ? n.readBy.some((id) => String(id) === String(adminId))
    : Boolean(n.memberRead),
  createdAt: n.createdAt,
});

// GET / - latest notifications + unread count for the requesting admin
router.get("/", verify, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const notifications = await Notification.find(ADMIN_FILTER)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const adminId = req.user._id;
    const unreadCount = notifications.filter(
      (n) => !n.readBy.some((id) => String(id) === String(adminId)),
    ).length;

    return res.json({
      success: true,
      unreadCount,
      notifications: notifications.map((n) =>
        serializeNotification(n, adminId),
      ),
    });
  } catch (error) {
    console.error("Notification list error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch notifications.",
    });
  }
});

// POST /read - mark all notifications as read for this admin
router.post("/read", verify, async (req, res) => {
  try {
    await Notification.updateMany(
      { ...ADMIN_FILTER, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } },
    );
    return res.json({
      success: true,
      message: "All notifications marked as read.",
    });
  } catch (error) {
    console.error("Notification mark-all error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update notifications.",
    });
  }
});

// POST /read/:id - mark a single notification as read for this admin
router.post("/read/:id", verify, async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, ...ADMIN_FILTER },
      { $addToSet: { readBy: req.user._id } },
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("Notification mark-read error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update notification.",
    });
  }
});

// GET /member - a logged-in member's own notifications + unread count
router.get("/member", verifyMembershipToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const notifications = await Notification.find({
      audience: "MEMBER",
      memberId: req.member._id,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const unreadCount = notifications.filter((n) => !n.memberRead).length;

    return res.json({
      success: true,
      unreadCount,
      notifications: notifications.map((n) =>
        serializeNotification(n, null),
      ),
    });
  } catch (error) {
    console.error("Member notification list error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch notifications.",
    });
  }
});

// POST /member/read - mark all of this member's notifications as read
router.post("/member/read", verifyMembershipToken, async (req, res) => {
  try {
    await Notification.updateMany(
      {
        audience: "MEMBER",
        memberId: req.member._id,
        memberRead: false,
      },
      { memberRead: true },
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("Member notification mark-all error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update notifications.",
    });
  }
});

// POST /member/read/:id - mark one of this member's notifications as read
router.post("/member/read/:id", verifyMembershipToken, async (req, res) => {
  try {
    await Notification.updateOne(
      {
        _id: req.params.id,
        audience: "MEMBER",
        memberId: req.member._id,
      },
      { memberRead: true },
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("Member notification mark-read error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to update notification.",
    });
  }
});

module.exports = router;
module.exports.createNotification = createNotification;
