const router = require("express").Router();
const verify = require("./verifyToken");
const MemberBackupSetting = require("../models/MemberBackupSetting");
const { BACKUP_EMAIL, FREQUENCIES, nextRunAfter, sendMemberListBackup } = require("../services/memberBackup");

const getSetting = () => MemberBackupSetting.findOne().sort({ createdAt: 1 });
const adminOnly = (req, res, next) => {
  if (req.user?.role !== "FULL_ACCESS") {
    return res.status(403).json({ success: false, message: "Administrator access required." });
  }
  next();
};

router.get("/", verify, adminOnly, async (req, res) => {
  const setting = await getSetting();
  return res.json({ success: true, recipient: BACKUP_EMAIL, setting: setting || { enabled: false, frequency: "weekly", lastSentAt: null, nextRunAt: null } });
});

router.put("/", verify, adminOnly, async (req, res) => {
  const frequency = String(req.body.frequency || "weekly").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FREQUENCIES, frequency)) return res.status(400).json({ success: false, message: "Choose daily, weekly, or monthly frequency." });
  const setting = (await getSetting()) || new MemberBackupSetting();
  setting.enabled = req.body.enabled === true;
  setting.frequency = frequency;
  setting.updatedBy = req.user?._id || null;
  setting.nextRunAt = setting.enabled ? nextRunAfter(new Date(), frequency) : null;
  await setting.save();
  return res.json({ success: true, message: setting.enabled ? "Member list backup schedule enabled." : "Member list backup schedule disabled.", setting });
});

router.post("/send-now", verify, adminOnly, async (req, res) => {
  try {
    await sendMemberListBackup();
    const setting = await getSetting();
    if (setting?.enabled) {
      setting.lastSentAt = new Date();
      setting.nextRunAt = nextRunAfter(setting.lastSentAt, setting.frequency);
      await setting.save();
    }
    return res.json({ success: true, message: `Backup sent to ${BACKUP_EMAIL}.`, recipient: BACKUP_EMAIL });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to send member list backup." });
  }
});

module.exports = router;
