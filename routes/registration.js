const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const RateLimit = require("express-rate-limit");
const svgCaptcha = require("svg-captcha");
const Registration = require("../models/Registration");
const ConsentLog = require("../models/ConsentLog");
const Grievance = require("../models/Grievance");
const PageContent = require("../models/PageContent");
const CaptchaCode = require("../models/CaptchaCode");
const verify = require("./verifyToken");
const { createNotification } = require("./notifications");
const { renderTemplate } = require("./emailTemplates");
const { saveCaptchaCode } = require("./captchacodes");

const EXCEL_PATH = path.resolve(
  __dirname,
  "../../send_email_to_registrants/registrations.xlsx",
);

// Anti-abuse: limit how fast registrations and captcha requests can come
// from a single IP so the public registration form cannot be bombarded.
const registerRateLimiter = RateLimit({ max: 5, windowMS: 10 * 60 * 1000 });
const captchaRateLimiter = RateLimit({ max: 30, windowMS: 10 * 60 * 1000 });

const JWT_SECRET = process.env.JWT_TOKEN_SECRET || "avatarindia-local-secret";

const verifyMembershipToken = require("../middleware/memberAuth");

const createMembershipToken = (member) =>
  jwt.sign(
    {
      _id: member._id,
      email: member.email,
      role: "MEMBER",
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );

const generateOtp = () =>
  String(crypto.randomInt(100000, 1000000)).padStart(6, "0");

// Consent validity duration in days (DPDP). Admins can configure this from
// the Consent Notice editor; falls back to CONSENT_DURATION_DAYS env / 365.
const getConsentDurationDays = async () => {
  try {
    const consentContent = await PageContent.findOne({
      page_key: "consent",
    }).lean();
    const days = Number(consentContent?.content?.consentDurationDays);
    if (Number.isFinite(days) && days > 0) return Math.round(days);
  } catch (error) {
    console.error("Failed to load consent duration:", error.message);
  }
  return Number(process.env.CONSENT_DURATION_DAYS || 365);
};

// Compute the expiry date for a freshly granted consent
const consentExpiryFor = async (from = new Date()) => {
  const days = await getConsentDurationDays();
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
};

// Effective expiry of a granted consent. Uses the stored expiry when present;
// for records granted before the expiry feature existed, derives it from the
// grant date + configured duration so no migration is needed.
const effectiveConsentExpiry = (member, durationDays = 365) => {
  if (member?.consentExpiresAt) return new Date(member.consentExpiresAt);
  if (member?.consentGivenAt && member?.consent) {
    return new Date(
      new Date(member.consentGivenAt).getTime() +
        durationDays * 24 * 60 * 60 * 1000,
    );
  }
  return null;
};

// Days left until consent expires (negative = expired). Null when not granted.
const consentDaysLeftOf = (member, durationDays = 365) => {
  const expiresAt = effectiveConsentExpiry(member, durationDays);
  if (!expiresAt) return null;
  return Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
};

/**
 * Append an immutable entry to the consent audit trail for a member.
 * Used by both member-side actions (registration, profile, revoke) and
 * admin-side actions (revoke, delete consent, delete member record).
 */
const logConsentEvent = async (
  member,
  action,
  performedBy,
  details,
  performedById = null,
) => {
  try {
    const log = new ConsentLog({
      memberId: member ? member._id : null,
      registrationNo: member ? member.registrationNo : "",
      memberName: member ? member.fullName || "" : "",
      memberEmail: member ? member.email || "" : "",
      action,
      performedBy,
      performedById,
      details,
    });
    await log.save();
  } catch (error) {
    console.error("Consent log error:", error.message);
  }
};

// Email / SMTP configuration. Prefers the Google Workspace variables from
// .env (SMTP_SERVER, SMTP_PORT, EMAIL, APP_PASSWORD), falling back to the
// older EMAIL_* / SMTP_* names for backward compatibility.
// Resolved at call time (not module load) because index.js/server.js call
// dotenv.config() AFTER the routes are required - a module-level constant
// would capture process.env before .env is loaded.
const getMailConfig = () => {
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587);
  return {
    host: process.env.SMTP_SERVER || process.env.EMAIL_HOST || process.env.SMTP_HOST,
    port,
    secure:
      String(process.env.EMAIL_SECURE || "").toLowerCase() === "true"
        ? true
        : port === 465,
    user: process.env.EMAIL || process.env.EMAIL_USER || process.env.SMTP_USER,
    pass:
      process.env.APP_PASSWORD ||
      process.env.EMAIL_PASS ||
      process.env.SMTP_PASS,
    from:
      process.env.EMAIL ||
      process.env.EMAIL_FROM ||
      process.env.SMTP_FROM ||
      process.env.EMAIL_USER ||
      process.env.SMTP_USER,
  };
};

const getTransporter = () => {
  const config = getMailConfig();

  if (!config.host || !config.user || !config.pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
};

const sendOtpEmail = async (email, otp) => {
  const transporter = getTransporter();

  if (!transporter) {
    console.log(`[DEV OTP] Email: ${email} | OTP: ${otp}`);
    return true;
  }

  const tpl = await renderTemplate("otp", { otp });

  await transporter.sendMail({
    from: getMailConfig().from,
    to: email,
    subject: tpl.subject,
    html: tpl.html,
  });

  return true;
};

// Notify a member by email when an admin revokes or deletes their consent.
// Returns true if the email was dispatched; never throws.
const sendConsentNotificationEmail = async (member, action) => {
  const transporter = getTransporter();
  const memberEmail = member ? member.email : "";

  if (!transporter || !memberEmail) {
    console.log(
      `[DEV] Consent notification (${action}) for ${memberEmail || "unknown"}: SMTP not configured or no email on record.`,
    );
    return false;
  }

  const isRevoke = action === "REVOKED";
  const memberName = member?.fullName || "AVATAR India Member";
  const eventDate = new Date().toLocaleString();

  const tpl = await renderTemplate(isRevoke ? "consent_revoked" : "consent_deleted", {
    memberName,
    date: eventDate,
  });

  try {
    await transporter.sendMail({
      from: getMailConfig().from,
      to: memberEmail,
      subject: tpl.subject,
      html: tpl.html,
    });
    return true;
  } catch (error) {
    console.error("Consent notification email error:", error.message);
    return false;
  }
};

// Email a member whose consent is pending, sharing the public link where they
// can log in with OTP and give their consent (DPDP right to be asked).
// Returns { sent: boolean }; never throws.
const sendConsentReminderEmail = async (member, loginUrl, grievanceContact) => {
  const transporter = getTransporter();
  const memberEmail = member ? member.email : "";

  if (!transporter) {
    console.log(
      `[DEV] Consent reminder for ${memberEmail || "unknown"}: SMTP not configured. Login link: ${loginUrl}`,
    );
    return { sent: false, reason: "no-smtp" };
  }
  if (!memberEmail) {
    return { sent: false, reason: "no-email" };
  }

  const memberName = member?.fullName || "AVATAR India Member";
  const grievanceContactLine = grievanceContact
    ? `<p>If you have any questions or concerns, you can reach our Grievance Officer at <a href="mailto:${grievanceContact}">${grievanceContact}</a>.</p>`
    : "";

  const tpl = await renderTemplate("consent_reminder", {
    memberName,
    loginUrl,
    grievanceContactLine,
  });

  try {
    await transporter.sendMail({
      from: getMailConfig().from,
      to: memberEmail,
      subject: tpl.subject,
      html: tpl.html,
    });
    return { sent: true };
  } catch (error) {
    console.error("Consent reminder email error:", error.message);
    return { sent: false, reason: "error" };
  }
};

// Multer in-memory storage for Excel import (no need to persist the upload)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
});

// Helper function to append registration to Excel file
async function appendToExcel(data) {
  const workbook = new ExcelJS.Workbook();

  if (fs.existsSync(EXCEL_PATH)) {
    await workbook.xlsx.readFile(EXCEL_PATH);
  } else {
    const ws = workbook.addWorksheet("MembershipLists");
    ws.addRow([
      "S.No",
      "Registration No",
      "Full Name",
      "Email Id",
      "Mobile No",
      "Expiry Date",
      "Date",
      "Time",
    ]);
  }

  let worksheet = workbook.getWorksheet("MembershipLists");
  if (!worksheet) {
    worksheet = workbook.getWorksheet(1);
  }

  let maxSNo = 0;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const val = row.getCell(1).value;
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > maxSNo) {
      maxSNo = num;
    }
  });

  const nextSNo = maxSNo > 0 ? maxSNo + 1 : 168;
  const regNo = `AIS${String(nextSNo).padStart(4, "0")}`;

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().split(" ")[0];

  const titlePrefix =
    data.title && data.title !== "Select Title" ? `${data.title} ` : "";
  const fullName = `${titlePrefix}${data.firstName} ${data.lastName}`.trim();

  worksheet.addRow([
    nextSNo,
    regNo,
    fullName,
    data.email,
    data.mobileNo,
    "LifeTime",
    dateStr,
    timeStr,
  ]);

  await workbook.xlsx.writeFile(EXCEL_PATH);
  return { sNo: nextSNo, regNo, fullName, dateStr, timeStr };
}

// Case-insensitive duplicate check for a registered email across the DB and
// the Excel list (members may exist in Excel without a DB record).
const checkDuplicateEmail = async (email) => {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;

  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dbMatch = await Registration.findOne({
    email: new RegExp(`^${escaped}$`, "i"),
  });
  if (dbMatch) return true;

  if (!fs.existsSync(EXCEL_PATH)) return false;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const worksheet =
    workbook.getWorksheet("MembershipLists") || workbook.getWorksheet(1);
  if (!worksheet) return false;

  let found = false;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = row.getCell(4).value;
    const val =
      cell === null || cell === undefined ? "" : String(cell).trim().toLowerCase();
    if (val && val === normalized) found = true;
  });
  return found;
};

// Remove the rows matching the given registration numbers from the Excel
// list (used by admin delete and member self-erasure).
const deleteRowsFromExcel = async (registrationNos) => {
  if (!fs.existsSync(EXCEL_PATH)) return;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const worksheet =
    workbook.getWorksheet("MembershipLists") || workbook.getWorksheet(1);
  if (!worksheet) return;

  const noSet = new Set(registrationNos);
  const rowsToRemove = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const regNo = String(
      row.getCell(2).value === null || row.getCell(2).value === undefined
        ? ""
        : row.getCell(2).value,
    ).trim();
    if (noSet.has(regNo)) {
      rowsToRemove.push(rowNumber);
    }
  });

  // Remove rows from bottom to top so earlier row numbers stay valid
  rowsToRemove.reverse().forEach((rowNumber) => {
    worksheet.spliceRows(rowNumber, 1);
  });

  await workbook.xlsx.writeFile(EXCEL_PATH);
};

const TITLE_PREFIXES = ["Dr.", "Prof.", "Mr.", "Mrs.", "Ms."];

// Split a full name (e.g. "Dr. Jane Doe") into a title prefix and a first name
const parseNameParts = (fullName) => {
  const trimmed = String(fullName || "").trim();
  const prefix = TITLE_PREFIXES.find((p) => trimmed.startsWith(p));
  if (!prefix) return { title: "", firstName: trimmed };
  return {
    title: prefix,
    firstName: trimmed.slice(prefix.length).trim(),
  };
};

// Verify a submitted captcha against the stored one-time-use code.
// The token is base64(bcrypt-hash of the captcha text); the code is consumed
// (marked "checked") on first use so it cannot be replayed.
const verifyCaptcha = async (captchaText, captchaToken) => {
  if (!captchaText || !captchaToken) return false;
  let hash;
  try {
    hash = Buffer.from(String(captchaToken), "base64").toString("ascii");
  } catch (error) {
    return false;
  }
  const record = await CaptchaCode.findOne({
    captcha_code: hash,
    status: "active",
  });
  if (!record) return false;
  // One-time use: consume the code regardless of whether the text matches
  record.status = "checked";
  await record.save().catch(() => {});
  return bcrypt.compare(String(captchaText), hash);
};

// GET /registration/captcha - serve a fresh captcha for the public
// registration form. Public (no auth token) so anyone can load the form.
router.get("/captcha", captchaRateLimiter, async (req, res) => {
  try {
    const captcha = svgCaptcha.create({
      size: 5,
      noise: 2,
      ignoreChars: "0oO1lI",
    });
    const salt = await bcrypt.genSalt(10);
    const hashedCaptcha = await bcrypt.hash(captcha.text, salt);
    const token = Buffer.from(hashedCaptcha).toString("base64");

    await saveCaptchaCode(hashedCaptcha);

    // Keep the store from growing forever: drop codes older than 30 minutes.
    CaptchaCode.deleteMany({
      updatedAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) },
    }).catch(() => {});

    return res.json({
      success: true,
      svg: captcha.data,
      atoken: token,
    });
  } catch (error) {
    console.error("Captcha generation error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to generate captcha.",
    });
  }
});

router.post("/request-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const member = await Registration.findOne({ email });
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "No registration found for this email address.",
      });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    member.otpHash = otpHash;
    member.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await member.save();

    await sendOtpEmail(email, otp);

    return res.status(200).json({
      success: true,
      message: "OTP has been sent to your email address.",
    });
  } catch (error) {
    console.error("Request OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to send OTP at this time.",
    });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const otp = String(req.body.otp || "").trim();

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required.",
      });
    }

    const member = await Registration.findOne({ email });
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "No registration found for this email address.",
      });
    }

    if (!member.otpHash || !member.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message:
          "No OTP was generated for this email. Please request a new one.",
      });
    }

    if (new Date() > new Date(member.otpExpiresAt)) {
      member.otpHash = "";
      member.otpExpiresAt = null;
      await member.save();

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one.",
      });
    }

    const isValidOtp = await bcrypt.compare(otp, member.otpHash);
    if (!isValidOtp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP.",
      });
    }

    const token = createMembershipToken(member);
    member.otpHash = "";
    member.otpExpiresAt = null;
    await member.save();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully.",
      token,
      member: {
        _id: member._id,
        registrationNo: member.registrationNo,
        fullName: member.fullName,
        email: member.email,
        mobileNo: member.mobileNo,
        title: member.title,
        firstName: member.firstName,
        lastName: member.lastName,
        country: member.country,
        speciality: member.speciality,
        hospitalName: member.hospitalName || "",
        designation: member.designation || "",
        consent: Boolean(member.consent),
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify OTP.",
    });
  }
});

router.get("/me", verifyMembershipToken, async (req, res) => {
  try {
    const member = await Registration.findById(req.member._id);

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found.",
      });
    }

    const consentDurationDays = await getConsentDurationDays();
    return res.status(200).json({
      success: true,
      member: {
        _id: member._id,
        registrationNo: member.registrationNo,
        fullName: member.fullName,
        email: member.email,
        mobileNo: member.mobileNo,
        title: member.title,
        firstName: member.firstName,
        lastName: member.lastName,
        country: member.country,
        speciality: member.speciality,
        hospitalName: member.hospitalName || "",
        designation: member.designation || "",
        consent: Boolean(member.consent),
        consentGivenAt: member.consentGivenAt,
        consentExpiresAt: effectiveConsentExpiry(member, consentDurationDays),
        consentDaysLeft: consentDaysLeftOf(member, consentDurationDays),
        consentDurationDays,
      },
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch member profile.",
    });
  }
});

router.put("/profile", verifyMembershipToken, async (req, res) => {
  try {
    const member = await Registration.findById(req.member._id);

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found.",
      });
    }

    if (req.body.firstName) member.firstName = req.body.firstName.trim();
    if (req.body.lastName) member.lastName = req.body.lastName.trim();
    if (req.body.mobileNo) member.mobileNo = req.body.mobileNo.trim();
    if (req.body.title) member.title = req.body.title.trim();
    if (req.body.country) member.country = req.body.country.trim();
    if (req.body.speciality) member.speciality = req.body.speciality.trim();
    if (req.body.hospitalName !== undefined)
      member.hospitalName = String(req.body.hospitalName).trim();
    if (req.body.designation !== undefined)
      member.designation = String(req.body.designation).trim();

    if (req.body.consent !== undefined) {
      const nextConsent = Boolean(req.body.consent);
      const prevConsent = Boolean(member.consent);
      member.consent = nextConsent;

      if (nextConsent && !member.consentGivenAt) {
        member.consentGivenAt = new Date();
      }
      if (!nextConsent) {
        member.consentRevokedAt = new Date();
      }
      if (nextConsent && member.consentRevokedAt) {
        member.consentRevokedAt = null;
      }
      if (nextConsent && member.consentDeletedAt) {
        // A re-granted consent after erasure restores an active consent
        member.consentDeletedAt = null;
      }

      // DPDP: a granted consent is valid for the configured duration.
      // Refresh the expiry on a fresh grant or re-grant after revoke/expiry.
      if (nextConsent) {
        const now = Date.now();
        const expiresAt = member.consentExpiresAt
          ? new Date(member.consentExpiresAt).getTime()
          : 0;
        if (!prevConsent || !member.consentExpiresAt || expiresAt < now) {
          member.consentExpiresAt = await consentExpiryFor();
        }
      } else {
        member.consentExpiresAt = null;
      }

      if (nextConsent !== prevConsent) {
        await logConsentEvent(
          member,
          nextConsent ? "GRANTED" : "REVOKED",
          "Member",
          nextConsent
            ? "Consent granted by the member via profile update."
            : "Consent revoked by the member via profile update.",
        );

        await createNotification({
          type: nextConsent ? "CONSENT_GRANTED" : "CONSENT_REVOKED",
          message: nextConsent
            ? `Consent granted by member: ${member.fullName} (${member.registrationNo})`
            : `Consent revoked by member: ${member.fullName} (${member.registrationNo})`,
          registrationNo: member.registrationNo,
          memberName: member.fullName,
          memberEmail: member.email,
        });
      }
    }

    member.fullName =
      `${(member.title || "").trim()} ${member.firstName} ${member.lastName}`.trim();
    await member.save();

    const consentDurationDays = await getConsentDurationDays();
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      member: {
        _id: member._id,
        registrationNo: member.registrationNo,
        fullName: member.fullName,
        email: member.email,
        mobileNo: member.mobileNo,
        title: member.title,
        firstName: member.firstName,
        lastName: member.lastName,
        country: member.country,
        speciality: member.speciality,
        hospitalName: member.hospitalName || "",
        designation: member.designation || "",
        consent: Boolean(member.consent),
        consentGivenAt: member.consentGivenAt,
        consentExpiresAt: effectiveConsentExpiry(member, consentDurationDays),
        consentDaysLeft: consentDaysLeftOf(member, consentDurationDays),
        consentDurationDays,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update member profile.",
    });
  }
});

router.post("/revoke-consent", verifyMembershipToken, async (req, res) => {
  try {
    const member = await Registration.findById(req.member._id);

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found.",
      });
    }

    member.consent = false;
    member.consentRevokedAt = new Date();
    member.consentExpiresAt = null;
    await member.save();

    await logConsentEvent(
      member,
      "REVOKED",
      "Member",
      "Consent revoked by the member from their profile.",
    );

    await createNotification({
      type: "CONSENT_REVOKED",
      message: `Consent revoked by member: ${member.fullName} (${member.registrationNo})`,
      registrationNo: member.registrationNo,
      memberName: member.fullName,
      memberEmail: member.email,
    });

    return res.status(200).json({
      success: true,
      message: "Consent revoked successfully.",
      member: {
        _id: member._id,
        consent: false,
      },
    });
  } catch (error) {
    console.error("Consent revoke error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to revoke consent.",
    });
  }
});

// POST: Admin revokes consent for a specific member
router.post("/admin/revoke-consent", verify, async (req, res) => {
  try {
    const registrationNo = String(req.body.registrationNo || "").trim();
    if (!registrationNo) {
      return res.status(400).json({
        success: false,
        message: "Registration number is required.",
      });
    }

    const member = await Registration.findOne({ registrationNo });
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found.",
      });
    }

    if (!member.consent) {
      return res.status(400).json({
        success: false,
        message: "This member has no active consent to revoke.",
      });
    }

    member.consent = false;
    member.consentRevokedAt = new Date();
    member.consentExpiresAt = null;
    await member.save();

    const emailSent = await sendConsentNotificationEmail(member, "REVOKED");
    await logConsentEvent(
      member,
      "REVOKED",
      `Admin: ${req.user.name || "Unknown"}`,
      emailSent
        ? "Consent revoked by an administrator. Notification email sent to the member."
        : "Consent revoked by an administrator. Notification email could not be sent.",
      req.user._id,
    );

    await createNotification({
      type: "CONSENT_REVOKED",
      message: `Consent revoked by admin: ${member.fullName} (${member.registrationNo})`,
      registrationNo: member.registrationNo,
      memberName: member.fullName,
      memberEmail: member.email,
    });

    // Notify the member too - the same event they were emailed about
    await createNotification({
      type: "CONSENT_REVOKED",
      message:
        "Your consent was revoked by the AVATAR India administration. A confirmation email was sent to you.",
      registrationNo: member.registrationNo,
      memberName: member.fullName,
      memberEmail: member.email,
      audience: "MEMBER",
      memberId: member._id,
    });

    return res.status(200).json({
      success: true,
      message: "Consent revoked successfully.",
    });
  } catch (error) {
    console.error("Admin consent revoke error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to revoke consent.",
    });
  }
});

// POST: Admin deletes (erases) the consent record for a specific member
router.post("/admin/delete-consent", verify, async (req, res) => {
  try {
    const registrationNo = String(req.body.registrationNo || "").trim();
    if (!registrationNo) {
      return res.status(400).json({
        success: false,
        message: "Registration number is required.",
      });
    }

    const member = await Registration.findOne({ registrationNo });
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found.",
      });
    }

    member.consent = false;
    member.consentGivenAt = null;
    member.consentRevokedAt = null;
    member.consentDeletedAt = null;
    member.consentExpiresAt = null;
    member.consentDeletedAt = new Date();
    await member.save();

    const emailSent = await sendConsentNotificationEmail(member, "DELETED");
    await logConsentEvent(
      member,
      "DELETED",
      `Admin: ${req.user.name || "Unknown"}`,
      emailSent
        ? "Consent record deleted (erasure) by an administrator. Notification email sent to the member."
        : "Consent record deleted (erasure) by an administrator. Notification email could not be sent.",
      req.user._id,
    );

    await createNotification({
      type: "CONSENT_DELETED",
      message: `Consent record deleted by admin: ${member.fullName} (${member.registrationNo})`,
      registrationNo: member.registrationNo,
      memberName: member.fullName,
      memberEmail: member.email,
    });

    // Notify the member too - the same event they were emailed about
    await createNotification({
      type: "CONSENT_DELETED",
      message:
        "Your consent record was deleted by the AVATAR India administration. A confirmation email was sent to you.",
      registrationNo: member.registrationNo,
      memberName: member.fullName,
      memberEmail: member.email,
      audience: "MEMBER",
      memberId: member._id,
    });

    return res.status(200).json({
      success: true,
      message: "Consent record deleted successfully.",
    });
  } catch (error) {
    console.error("Admin consent delete error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete consent record.",
    });
  }
});

// POST: Send consent reminder emails to members whose consent is not active.
// Body: { registrationNos?: string[] } — when omitted, emails ALL pending
// members (consent never given). When specific registration numbers are
// provided (e.g. re-asking a member from the consent popup), revoked, deleted
// and expired members are included too so consent can be re-requested.
router.post("/consent-reminder", verify, async (req, res) => {
  try {
    const requested = Array.isArray(req.body.registrationNos)
      ? req.body.registrationNos.map((v) => String(v).trim()).filter(Boolean)
      : [];

    let filter;
    if (requested.length > 0) {
      // Targeted re-ask: any member without active (unexpired) consent
      filter = {
        registrationNo: { $in: requested },
        $or: [{ consent: false }, { consent: true, consentExpiresAt: { $lt: new Date() } }],
      };
    } else {
      // Bulk: consent never given, not revoked and not erased
      filter = {
        consent: false,
        consentRevokedAt: null,
        consentDeletedAt: null,
      };
    }

    const pendingMembers = await Registration.find(filter);

    const frontendUrl = (
      process.env.FRONTEND_URL ||
      `http://${req.get("host") || "localhost:3006"}` ||
      "http://localhost:3006"
    ).replace(/\/+$/, "");
    const loginUrl = `${frontendUrl}/membership/profile`;

    // Pull the Grievance Officer contact from the backend-managed consent content
    let grievanceContact = "";
    try {
      const consentContent = await PageContent.findOne({
        page_key: "consent",
      }).lean();
      grievanceContact = consentContent?.content?.grievanceContact || "";
    } catch (error) {
      console.error("Failed to load consent page content:", error.message);
    }

    // If SMTP is not configured in the current process, fail with a clear,
    // actionable message instead of a misleading "skipped" summary.
    if (!getTransporter()) {
      return res.status(400).json({
        success: false,
        message:
          "SMTP is not configured in the running server. Check SMTP_SERVER, EMAIL and APP_PASSWORD in backend/.env, then restart the backend server.",
      });
    }

    let sent = 0;
    let noEmail = 0;
    let sendErrors = 0;
    const emailed = [];
    for (const member of pendingMembers) {
      const result = await sendConsentReminderEmail(
        member,
        loginUrl,
        grievanceContact,
      );
      if (result.sent) {
        sent += 1;
        emailed.push({
          registrationNo: member.registrationNo,
          fullName: member.fullName,
          email: member.email,
        });

        // Mirror the email in the member's notification bell
        await createNotification({
          type: "CONSENT_REMINDED",
          message:
            "AVATAR India sent you an email requesting your consent. Log in with OTP and give your consent from the member portal.",
          registrationNo: member.registrationNo,
          memberName: member.fullName,
          memberEmail: member.email,
          audience: "MEMBER",
          memberId: member._id,
        });
      } else if (result.reason === "no-email") {
        noEmail += 1;
      } else {
        sendErrors += 1;
      }
    }

    const notes = [];
    if (noEmail > 0) {
      notes.push(`${noEmail} skipped (no email on record)`);
    }
    if (sendErrors > 0) {
      notes.push(`${sendErrors} failed to send (check server logs)`);
    }

    return res.json({
      success: true,
      message: `Consent reminder emails sent to ${sent} member${sent !== 1 ? "s" : ""}${notes.length ? ` (${notes.join(", ")})` : ""}.`,
      pending: pendingMembers.length,
      sent,
      skipped: noEmail + sendErrors,
      noEmail,
      sendErrors,
      loginUrl,
      emailed,
    });
  } catch (error) {
    console.error("Consent reminder error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to send consent reminders.",
    });
  }
});

// GET: Consent audit log (optionally filtered by registration number)
router.get("/consent-logs", verify, async (req, res) => {
  try {
    const registrationNo = String(req.query.registrationNo || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const filter = registrationNo ? { registrationNo } : {};
    const logs = await ConsentLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      count: logs.length,
      logs: logs.map((log) => ({
        _id: log._id,
        registrationNo: log.registrationNo,
        memberName: log.memberName,
        memberEmail: log.memberEmail,
        action: log.action,
        performedBy: log.performedBy,
        details: log.details,
        createdAt: log.createdAt,
      })),
    });
  } catch (error) {
    console.error("Consent logs error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch consent logs.",
    });
  }
});

// DELETE: Delete one or more members (record + Excel row) and log consent erasure
router.delete("/delete", verify, async (req, res) => {
  try {
    const registrationNos = Array.isArray(req.body.registrationNos)
      ? req.body.registrationNos.map((v) => String(v).trim()).filter(Boolean)
      : [];

    if (registrationNos.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No registration numbers provided.",
      });
    }

    const members = await Registration.find({
      registrationNo: { $in: registrationNos },
    });

    for (const member of members) {
      await logConsentEvent(
        member,
        "DELETED",
        `Admin: ${req.user.name || "Unknown"}`,
        "Member record deleted (right to erasure) by an administrator.",
        req.user._id,
      );

      await createNotification({
        type: "MEMBER_DELETED",
        message: `Member record deleted by admin: ${member.fullName} (${member.registrationNo})`,
        registrationNo: member.registrationNo,
        memberName: member.fullName,
        memberEmail: member.email,
      });

      await member.deleteOne();
    }

    await deleteRowsFromExcel(registrationNos);

    return res.json({
      success: true,
      deleted: members.length,
    });
  } catch (error) {
    console.error("Member delete error:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to delete members.",
    });
  }
});

// DELETE /account - the member deletes their own records (right to erasure)
router.delete("/account", verifyMembershipToken, async (req, res) => {
  try {
    const member = await Registration.findById(req.member._id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member record not found.",
      });
    }

    // Log the erasure BEFORE deleting so the audit trail survives
    await logConsentEvent(
      member,
      "DELETED",
      "Member",
      "Member deleted their own record (right to erasure) from the member portal.",
    );

    await createNotification({
      type: "MEMBER_DELETED",
      message: `Member deleted their own record (right to erasure): ${member.fullName} (${member.registrationNo})`,
      registrationNo: member.registrationNo,
      memberName: member.fullName,
      memberEmail: member.email,
    });

    // Erase the member's personal data from the registration list
    await deleteRowsFromExcel([member.registrationNo]);

    // Erase grievances (they contain the member's personal data)
    await Grievance.deleteMany({ memberId: member._id });

    await member.deleteOne();

    return res.json({
      success: true,
      message: "Your records have been deleted successfully.",
    });
  } catch (error) {
    console.error("Member account delete error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete your records.",
    });
  }
});

// POST: Register user
router.post("/register", registerRateLimiter, async (req, res) => {
  try {
    // Captcha guard: prevents bots from bombarding the registration endpoint.
    const captchaValid = await verifyCaptcha(
      req.body.captchaText,
      req.body.captchaToken,
    );
    if (!captchaValid) {
      return res.status(400).json({
        success: false,
        captchaError: true,
        message: "Invalid or expired captcha. Please refresh and try again.",
      });
    }

    const {
      mobileNo,
      email,
      title,
      firstName,
      lastName,
      country,
      speciality,
      membershipPlan,
      amount,
      hospitalName,
      designation,
    } = req.body;

    if (!mobileNo || !email || !firstName || !lastName || !title) {
      return res.status(400).json({
        success: false,
        message: "Please fill in all required fields.",
      });
    }

    if (!req.body.consent) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide your consent for the data you are submitting before registering.",
      });
    }

    if (await checkDuplicateEmail(email)) {
      return res.status(400).json({
        success: false,
        alreadyRegistered: true,
        message:
          "An account already exists with this email address. Please login with OTP instead.",
      });
    }

    const { sNo, regNo, fullName, dateStr, timeStr } = await appendToExcel({
      mobileNo,
      email,
      title,
      firstName,
      lastName,
      country,
      speciality,
      membershipPlan,
      amount,
    });

    try {
      const newRegistration = new Registration({
        sNo,
        registrationNo: regNo,
        mobileNo,
        email,
        title,
        firstName,
        lastName,
        fullName,
        country: country || "India",
        speciality: speciality || "",
        hospitalName: hospitalName || "",
        designation: designation || "",
        membershipPlan: membershipPlan || "Lifetime",
        amount: amount || 5000,
        expiryDate: "LifeTime",
        consent: true,
        consentGivenAt: new Date(),
        consentRevokedAt: null,
        consentDeletedAt: null,
        consentExpiresAt: await consentExpiryFor(),
      });
      const savedRegistration = await newRegistration.save();

      await logConsentEvent(
        savedRegistration,
        "GRANTED",
        "Member (online registration)",
        "Consent granted during membership registration.",
      );

      await createNotification({
        type: "REGISTRATION",
        message: `New membership registration: ${fullName} (${regNo})`,
        registrationNo: regNo,
        memberName: fullName,
        memberEmail: email,
      });
    } catch (dbErr) {
      console.warn("Database save warning:", dbErr.message);
    }

    return res.status(201).json({
      success: true,
      message: "Registration successful!",
      data: {
        sNo,
        registrationNo: regNo,
        fullName,
        email,
        mobileNo,
        date: dateStr,
        time: timeStr,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred during registration. " + error.message,
    });
  }
});

// GET: List all registrations
router.get("/list", async (req, res) => {
  try {
    const dbRegistrations = await Registration.find({})
      .sort({ sNo: -1 })
      .lean();
    const dbMap = new Map(
      dbRegistrations.map((item) => [String(item.registrationNo), item]),
    );

    const workbook = new ExcelJS.Workbook();
    if (!fs.existsSync(EXCEL_PATH)) {
      return res.json({ success: true, count: 0, registrations: [] });
    }
    await workbook.xlsx.readFile(EXCEL_PATH);
    const worksheet =
      workbook.getWorksheet("MembershipLists") || workbook.getWorksheet(1);

    const normalizeCell = (v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object") {
        if (v instanceof Date) return v;
        if (v.richText) return v.richText.map((t) => t.text).join("");
        if (v.text) return v.text;
        if (v.formula) return v.result ?? "";
      }
      return v;
    };

    const formatDate = (v) => {
      if (v instanceof Date) {
        const d = String(v.getDate()).padStart(2, "0");
        const m = String(v.getMonth() + 1).padStart(2, "0");
        return `${d}/${m}/${v.getFullYear()}`;
      }
      return String(v ?? "").trim();
    };

    const formatTime = (v) => {
      if (v instanceof Date) return v.toTimeString().slice(0, 8);
      if (typeof v === "object" && v !== null && "hours" in v) {
        const p = (n) => String(n ?? 0).padStart(2, "0");
        return `${p(v.hours)}:${p(v.minutes)}:${p(v.seconds)}`;
      }
      return String(v ?? "").trim();
    };

    const durationDays = await getConsentDurationDays();
    const registrations = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const c = (i) => normalizeCell(row.getCell(i).value);
      const registrationNo = String(c(2) ?? "").trim();
      const fullName = String(c(3) ?? "").trim();
      if (!registrationNo && !fullName) return;

      const dbRecord = dbMap.get(registrationNo) || null;
      const hasConsent = Boolean(dbRecord?.consent);
      const now = Date.now();
      const effectiveExpiry = effectiveConsentExpiry(dbRecord, durationDays);
      const expiresAt = effectiveExpiry ? effectiveExpiry.getTime() : 0;

      let consentStatus;
      if (dbRecord?.consentDeletedAt) {
        consentStatus = "Deleted";
      } else if (dbRecord?.consentRevokedAt) {
        consentStatus = "Revoked";
      } else if (hasConsent && expiresAt && expiresAt < now) {
        consentStatus = "Expired";
      } else if (hasConsent) {
        consentStatus = "Granted";
      } else {
        consentStatus = "Not Given";
      }

      const consentDaysLeft = expiresAt
        ? Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000))
        : null;
      const consentExpiringSoon =
        consentStatus === "Granted" &&
        consentDaysLeft !== null &&
        consentDaysLeft > 0 &&
        consentDaysLeft <= 30;

      registrations.push({
        sNo: Number(c(1)) || 0,
        registrationNo,
        fullName,
        email: String(c(4) ?? "").trim(),
        mobileNo: String(c(5) ?? "").trim(),
        expiryDate: formatDate(c(6)),
        date: formatDate(c(7)),
        time: formatTime(c(8)),
        consent: hasConsent,
        consentStatus,
        consentGivenAt: dbRecord?.consentGivenAt ?? null,
        consentRevokedAt: dbRecord?.consentRevokedAt ?? null,
        consentDeletedAt: dbRecord?.consentDeletedAt ?? null,
        consentExpiresAt: effectiveExpiry,
        consentDaysLeft,
        consentExpiringSoon,
      });
    });

    registrations.sort((a, b) => b.sNo - a.sNo);

    return res.json({
      success: true,
      count: registrations.length,
      consentDurationDays: await getConsentDurationDays(),
      registrations,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Export all registrations as an Excel file
router.get("/export", verify, async (req, res) => {
  try {
    if (!fs.existsSync(EXCEL_PATH)) {
      return res.status(404).json({
        success: false,
        error: "No registration data available to export.",
      });
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="registrations.xlsx"',
    );
    return res.sendFile(EXCEL_PATH);
  } catch (error) {
    console.error("Export error:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to export registrations.",
    });
  }
});

// POST: Add a member manually from the admin panel
router.post("/add", verify, async (req, res) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    if (!fullName) {
      return res.status(400).json({
        success: false,
        error: "Member full name is required.",
      });
    }

    const email = String(req.body.email || "").trim();
    const mobileNo = String(req.body.mobileNo || "").trim();
    const expiryDate = String(req.body.expiryDate || "LifeTime").trim();
    const providedDate = String(req.body.date || "").trim();
    const providedTime = String(req.body.time || "").trim();

    const workbook = new ExcelJS.Workbook();
    let worksheet;
    if (fs.existsSync(EXCEL_PATH)) {
      await workbook.xlsx.readFile(EXCEL_PATH);
      worksheet =
        workbook.getWorksheet("MembershipLists") || workbook.getWorksheet(1);
    } else {
      worksheet = workbook.addWorksheet("MembershipLists");
      worksheet.addRow([
        "S.No",
        "Registration No",
        "Full Name",
        "Email Id",
        "Mobile No",
        "Expiry Date",
        "Date",
        "Time",
      ]);
    }

    let maxSNo = 0;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const val = row.getCell(1).value;
      const num = parseInt(val, 10);
      if (!isNaN(num) && num > maxSNo) {
        maxSNo = num;
      }
    });

    const nextSNo = maxSNo > 0 ? maxSNo + 1 : 168;
    const regNo = `AIS${String(nextSNo).padStart(4, "0")}`;

    const now = new Date();
    const dateStr =
      providedDate || now.toISOString().split("T")[0];
    const timeStr = providedTime || now.toTimeString().split(" ")[0];

    worksheet.addRow([
      nextSNo,
      regNo,
      fullName,
      email,
      mobileNo,
      expiryDate,
      dateStr,
      timeStr,
    ]);

    await workbook.xlsx.writeFile(EXCEL_PATH);

    // Save to DB as well so consent can be managed for this member.
    // If the DB save fails (e.g. missing email/mobile), the member still
    // exists in the Excel list - consent just cannot be managed for them.
    try {
      const { title, firstName } = parseNameParts(fullName);
      const newRegistration = new Registration({
        sNo: nextSNo,
        registrationNo: regNo,
        mobileNo,
        email,
        title,
        firstName,
        lastName: "",
        fullName,
        country: "India",
        expiryDate,
        consent: false,
      });
      await newRegistration.save();
    } catch (dbErr) {
      console.warn("Database save warning (add member):", dbErr.message);
    }

    return res.status(201).json({
      success: true,
      message: "Member added successfully",
      registrationNo: regNo,
    });
  } catch (error) {
    console.error("Member add error:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to add member.",
    });
  }
});

// POST: Update a member from the admin panel
router.post("/update/:registrationNo", verify, async (req, res) => {
  try {
    const registrationNo = String(req.params.registrationNo || "").trim();
    if (!registrationNo) {
      return res.status(400).json({
        success: false,
        error: "Registration number is required.",
      });
    }

    const fullName = String(req.body.fullName || "").trim();
    if (!fullName) {
      return res.status(400).json({
        success: false,
        error: "Member full name is required.",
      });
    }

    const email = String(req.body.email || "").trim();
    const mobileNo = String(req.body.mobileNo || "").trim();
    const expiryDate = String(req.body.expiryDate || "LifeTime").trim();

    // Update the matching row in Excel
    let found = false;
    if (fs.existsSync(EXCEL_PATH)) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(EXCEL_PATH);
      const worksheet =
        workbook.getWorksheet("MembershipLists") || workbook.getWorksheet(1);
      if (worksheet) {
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const regNo = String(
            row.getCell(2).value === null || row.getCell(2).value === undefined
              ? ""
              : row.getCell(2).value,
          ).trim();
          if (regNo === registrationNo) {
            row.getCell(3).value = fullName;
            row.getCell(4).value = email;
            row.getCell(5).value = mobileNo;
            row.getCell(6).value = expiryDate;
            found = true;
          }
        });
        if (found) {
          await workbook.xlsx.writeFile(EXCEL_PATH);
        }
      }
    }

    if (!found) {
      return res.status(404).json({
        success: false,
        error: "Member not found in the registration list.",
      });
    }

    // Update the DB record too (if one exists)
    const member = await Registration.findOne({ registrationNo });
    if (member) {
      member.fullName = fullName;
      member.email = email;
      member.mobileNo = mobileNo;
      member.expiryDate = expiryDate;
      await member.save();
    }

    return res.json({
      success: true,
      message: "Member updated successfully.",
    });
  } catch (error) {
    console.error("Member update error:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to update member.",
    });
  }
});

router.get("/consent-status", async (req, res) => {
  try {
    const email = String(req.query.email || "")
      .trim()
      .toLowerCase();
    const member = email ? await Registration.findOne({ email }).lean() : null;

    if (!member) {
      return res.json({
        success: true,
        hasConsent: false,
        canRevoke: false,
        consentGivenAt: null,
        consentRevokedAt: null,
      });
    }

    return res.json({
      success: true,
      hasConsent: Boolean(member.consent),
      canRevoke: Boolean(member.consent),
      consentGivenAt: member.consentGivenAt || null,
      consentRevokedAt: member.consentRevokedAt || null,
    });
  } catch (error) {
    console.error("Consent status error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch consent status.",
    });
  }
});

// POST: Import registrations from an uploaded Excel file.
// Appends the new members to the master registration Excel file AND creates
// their database records, so imported members appear in the Registered
// Members page with full consent management. Rows whose registration number
// already exists in the master list or the database are skipped as
// duplicates (so the same file can be uploaded again safely).
router.post("/import", verify, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet =
      workbook.getWorksheet("MembershipLists") || workbook.getWorksheet(1);
    if (!worksheet) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid membership file" });
    }

    const normalizeCell = (v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object") {
        if (v instanceof Date) return v;
        if (v.richText) return v.richText.map((t) => t.text).join("");
        if (v.text) return v.text;
        if (v.formula) return v.result ?? "";
      }
      return v;
    };

    // Excel stores dates as strings ("01 Mar 2024"), Date objects or serial
    // numbers; convert any of them to a Date (or null when unparseable).
    const toDate = (v) => {
      if (v instanceof Date) return v;
      if (typeof v === "number" && Number.isFinite(v)) {
        return new Date(Math.round((v - 25569) * 86400000));
      }
      const s = String(v ?? "").trim();
      if (!s) return null;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const fmtTime = (v) => {
      if (v instanceof Date) return v.toTimeString().slice(0, 8);
      if (typeof v === "object" && v !== null && "hours" in v) {
        const p = (n) => String(n ?? 0).padStart(2, "0");
        return `${p(v.hours)}:${p(v.minutes)}:${p(v.seconds)}`;
      }
      return String(v ?? "").trim();
    };

    // Collect the valid data rows from the uploaded file.
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const c = (i) => normalizeCell(row.getCell(i).value);
      const rawDate = c(7);
      const rowData = {
        sNo: Number(c(1)) || 0,
        registrationNo: String(c(2) ?? "").trim(),
        fullName: String(c(3) ?? "").trim(),
        email: String(c(4) ?? "").trim(),
        mobileNo: String(c(5) ?? "").trim(),
        expiryDate: String(c(6) ?? "").trim() || "LifeTime",
        date: rawDate,
        registeredAt: toDate(rawDate),
        time: fmtTime(c(8)),
      };
      if (rowData.registrationNo || rowData.fullName) {
        rows.push(rowData);
      }
    });

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No member rows found in the uploaded file.",
      });
    }

    // Load the master registration list so new rows are appended to it and
    // duplicates are detected.
    const master = new ExcelJS.Workbook();
    let masterWs;
    if (fs.existsSync(EXCEL_PATH)) {
      await master.xlsx.readFile(EXCEL_PATH);
      masterWs =
        master.getWorksheet("MembershipLists") || master.getWorksheet(1);
    }
    if (!masterWs) {
      masterWs = master.addWorksheet("MembershipLists");
      masterWs.addRow([
        "S.No",
        "Registration No",
        "Full Name",
        "Email Id",
        "Mobile No",
        "Expiry Date",
        "Date",
        "Time",
      ]);
    }

    // Existing registration numbers, emails (for duplicate detection) and
    // max S.No from the master Excel + database.
    const existingRegNos = new Set();
    const existingEmails = new Set();
    let maxSNo = 0;
    masterWs.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const regNo = String(
        row.getCell(2).value === null || row.getCell(2).value === undefined
          ? ""
          : row.getCell(2).value,
      ).trim();
      if (regNo) existingRegNos.add(regNo);
      const email = String(row.getCell(4).value ?? "").trim().toLowerCase();
      if (email) existingEmails.add(email);
      const sNo = parseInt(row.getCell(1).value, 10);
      if (!isNaN(sNo) && sNo > maxSNo) maxSNo = sNo;
    });

    const uploadedRegNos = rows
      .map((r) => r.registrationNo)
      .filter(Boolean);
    const dbRecords = await Registration.find(
      {
        $or: [
          { registrationNo: { $in: uploadedRegNos } },
          { email: { $in: rows.map((r) => r.email).filter(Boolean) } },
        ],
      },
      { registrationNo: 1, email: 1 },
    ).lean();
    dbRecords.forEach((r) => {
      existingRegNos.add(String(r.registrationNo));
      if (r.email) existingEmails.add(String(r.email).trim().toLowerCase());
    });

    // Merge: skip duplicates (same registration number OR email), assign
    // registration numbers where missing.
    let added = 0;
    let skipped = 0;
    const addedRows = [];
    for (const row of rows) {
      const emailKey = row.email.toLowerCase();
      if (row.registrationNo && existingRegNos.has(row.registrationNo)) {
        skipped += 1;
        continue;
      }
      if (!row.fullName) {
        skipped += 1;
        continue;
      }
      if (emailKey && existingEmails.has(emailKey)) {
        skipped += 1;
        continue;
      }

      let registrationNo = row.registrationNo;
      let sNo = row.sNo;
      if (!registrationNo) {
        // No identity: assign the next sNo and matching registration number
        maxSNo += 1;
        sNo = maxSNo;
        registrationNo = `AIS${String(sNo).padStart(4, "0")}`;
      } else {
        if (!sNo) {
          maxSNo += 1;
          sNo = maxSNo;
        }
        if (sNo > maxSNo) maxSNo = sNo;
      }

      existingRegNos.add(registrationNo);
      if (emailKey) existingEmails.add(emailKey);
      added += 1;
      addedRows.push({
        sNo,
        registrationNo,
        fullName: row.fullName,
        email: row.email,
        mobileNo: row.mobileNo,
        expiryDate: row.expiryDate,
        date: row.date,
        registeredAt: row.registeredAt,
        time: row.time,
      });
    }

    // Append the new members to the master Excel file.
    addedRows.forEach((r) => {
      masterWs.addRow([
        r.sNo,
        r.registrationNo,
        r.fullName,
        r.email,
        r.mobileNo,
        r.expiryDate,
        r.date,
        r.time,
      ]);
    });
    await master.xlsx.writeFile(EXCEL_PATH);

    // Create database records so consent can be managed for imported members.
    let dbCreated = 0;
    let dbFailed = 0;
    for (const r of addedRows) {
      try {
        const newRegistration = new Registration({
          sNo: r.sNo,
          registrationNo: r.registrationNo,
          mobileNo: r.mobileNo,
          email: r.email,
          title: "",
          firstName: "",
          lastName: "",
          fullName: r.fullName,
          country: "India",
          speciality: "",
          hospitalName: "",
          designation: "",
          membershipPlan: "Lifetime",
          amount: 5000,
          expiryDate: r.expiryDate || "LifeTime",
          registeredAt: r.registeredAt || new Date(),
          consent: false,
        });
        await newRegistration.save();
        dbCreated += 1;
      } catch (dbErr) {
        // Keep the member in the Excel list even if the DB save fails
        // (e.g. missing email/mobile) - same behaviour as Add Member.
        console.warn("Database save warning (import):", dbErr.message);
        dbFailed += 1;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Import complete: ${added} added, ${skipped} skipped (${rows.length} total). ${dbCreated} record${dbCreated !== 1 ? "s" : ""} saved to the database${dbFailed ? `, ${dbFailed} could not be saved (missing email/mobile?)` : ""}.`,
      added,
      skipped,
      total: rows.length,
      dbCreated,
      dbFailed,
      registrations: addedRows,
    });
  } catch (error) {
    console.error("Import error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to import registrations.",
    });
  }
});

module.exports = router;
module.exports.logConsentEvent = logConsentEvent;
module.exports.checkDuplicateEmail = checkDuplicateEmail;
