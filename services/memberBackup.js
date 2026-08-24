const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");
const Registration = require("../models/Registration");
const MemberBackupSetting = require("../models/MemberBackupSetting");

const BACKUP_EMAIL = "info@avatarindia.org";
const FREQUENCIES = { daily: 1, weekly: 7, monthly: 30 };
let schedulerStarted = false;

const getMailConfig = () => ({
  host: process.env.SMTP_SERVER || process.env.EMAIL_HOST || process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587),
  user: process.env.EMAIL || process.env.EMAIL_USER || process.env.SMTP_USER,
  pass: process.env.APP_PASSWORD || process.env.EMAIL_PASS || process.env.SMTP_PASS,
  from: process.env.EMAIL || process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.EMAIL_USER || process.env.SMTP_USER,
});

const getTransporter = () => {
  const config = getMailConfig();
  if (!config.host || !config.user || !config.pass) return null;
  return nodemailer.createTransport({ host: config.host, port: config.port, secure: config.port === 465, auth: { user: config.user, pass: config.pass } });
};

const nextRunAfter = (from, frequency) => {
  const next = new Date(from);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + FREQUENCIES[frequency]);
  return next;
};

const createWorkbook = async () => {
  const docs = await Registration.find({}).sort({ sNo: 1 }).lean();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("MembershipLists");
  worksheet.addRow(["S.No", "Registration No", "Full Name", "Email Id", "Mobile No", "Expiry Date", "Date", "Time"]);
  docs.forEach((doc) => {
    const registeredAt = doc.registeredAt ? new Date(doc.registeredAt) : null;
    worksheet.addRow([
      doc.sNo, doc.registrationNo, doc.fullName, doc.email || "", doc.mobileNo || "", doc.expiryDate || "LifeTime",
      doc.date || (registeredAt ? registeredAt.toISOString().split("T")[0] : ""),
      doc.time || (registeredAt ? registeredAt.toTimeString().split(" ")[0] : ""),
    ]);
  });
  return workbook.xlsx.writeBuffer();
};

const sendMemberListBackup = async () => {
  const transporter = getTransporter();
  if (!transporter) throw new Error("SMTP is not configured. Check SMTP_SERVER, EMAIL and APP_PASSWORD.");
  const buffer = await createWorkbook();
  const config = getMailConfig();
  await transporter.sendMail({
    from: `"AVATAR India Society" <${config.from || BACKUP_EMAIL}>`,
    to: BACKUP_EMAIL,
    subject: "AVATAR India registered members database backup",
    text: "Attached is the latest registered members list exported from the database. This file can be restored from the Member List Backup admin page.",
    attachments: [{ filename: "registrations-backup.xlsx", content: buffer }],
  });
};

const runScheduledBackup = async () => {
  const setting = await MemberBackupSetting.findOne();
  if (!setting?.enabled || !setting.nextRunAt || new Date(setting.nextRunAt) > new Date()) return;
  try {
    await sendMemberListBackup();
    setting.lastSentAt = new Date();
    setting.nextRunAt = nextRunAfter(setting.lastSentAt, setting.frequency);
    await setting.save();
    console.log(`Member list backup sent to ${BACKUP_EMAIL}`);
  } catch (error) {
    console.error("Scheduled member list backup failed:", error.message);
    setting.nextRunAt = nextRunAfter(new Date(), setting.frequency);
    await setting.save();
  }
};

const startMemberBackupScheduler = () => {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(() => runScheduledBackup().catch((error) => console.error("Member backup scheduler error:", error.message)), 60 * 1000);
};

module.exports = { BACKUP_EMAIL, FREQUENCIES, nextRunAfter, sendMemberListBackup, startMemberBackupScheduler };
