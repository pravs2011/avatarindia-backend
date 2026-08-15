const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const Registration = require("../models/Registration");
const ConsentLog = require("../models/ConsentLog");
const Grievance = require("../models/Grievance");
const Gallery = require("../models/Gallery");
const VideoGallery = require("../models/VideoGallery");
const Abstract = require("../models/Abstract");
const Executive = require("../models/Executive");
const Committee = require("../models/Committee");
const BoardMember = require("../models/BoardMember");
const ExecutiveType = require("../models/ExecutiveType");
const PageContent = require("../models/PageContent");
const verify = require("./verifyToken");

const EXCEL_PATH = path.resolve(
  __dirname,
  "../../send_email_to_registrants/registrations.xlsx",
);

// Consent validity duration in days (DPDP). Same source as the Registered
// Members list endpoint, so consent statuses stay consistent.
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

// Effective expiry of a granted consent. Uses the stored expiry when present;
// for records granted before the expiry feature existed, derives it from the
// grant date + configured duration (mirrors registration.js).
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

// Same status rules as the Registered Members list endpoint.
const consentStatusOf = (dbRecord, durationDays) => {
  const hasConsent = Boolean(dbRecord?.consent);
  const expiresAt = effectiveConsentExpiry(dbRecord, durationDays);
  if (dbRecord?.consentDeletedAt) return "Deleted";
  if (dbRecord?.consentRevokedAt) return "Revoked";
  if (hasConsent && expiresAt && expiresAt.getTime() < Date.now()) {
    return "Expired";
  }
  if (hasConsent) return "Granted";
  return "Not Given";
};

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
const parseExcelDate = (v) => {
  if (v instanceof Date) return v;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial date: days since 1899-12-30
    return new Date(Math.round((v - 25569) * 86400000));
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// Read the member list from the registration Excel file (the source of truth
// used by the Registered Members page) and merge each row with its DB record
// so totals and consent state match what admins see on the members page.
const loadMembers = async () => {
  const dbRegistrations = await Registration.find({}).lean();
  const dbMap = new Map(
    dbRegistrations.map((item) => [String(item.registrationNo), item]),
  );
  const durationDays = await getConsentDurationDays();
  const members = [];

  if (!fs.existsSync(EXCEL_PATH)) return members;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const worksheet =
    workbook.getWorksheet("MembershipLists") || workbook.getWorksheet(1);

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const c = (i) => normalizeCell(row.getCell(i).value);
    const registrationNo = String(c(2) ?? "").trim();
    const fullName = String(c(3) ?? "").trim();
    if (!registrationNo && !fullName) return;

    const dbRecord = dbMap.get(registrationNo) || null;
    members.push({
      registrationNo,
      registeredAt: parseExcelDate(c(7)),
      consentStatus: consentStatusOf(dbRecord, durationDays),
    });
  });

  return members;
};

// GET /api/stats - Website statistics dashboard (admin only)
// Aggregates membership, consent, grievances, media galleries and content.
router.get("/", verify, async (req, res) => {
  try {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const [
      countries,
      specialities,
      plans,
      consentLogAgg,
      grievanceAgg,
      grievanceTotal,
      galleryAgg,
      videoAgg,
      abstractCount,
      executiveCount,
      committeeCount,
      boardMemberCount,
      executiveTypeCount,
    ] = await Promise.all([
      Registration.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$country", "Unknown"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      Registration.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$speciality", "Not specified"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      Registration.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$membershipPlan", "Lifetime"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),

      ConsentLog.aggregate([
        { $group: { _id: "$action", count: { $sum: 1 } } },
      ]),

      Grievance.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Grievance.countDocuments(),

      Gallery.aggregate([
        {
          $project: {
            imageCount: { $size: { $ifNull: ["$images", []] } },
          },
        },
        {
          $group: {
            _id: null,
            albums: { $sum: 1 },
            images: { $sum: "$imageCount" },
          },
        },
      ]),

      VideoGallery.aggregate([
        {
          $project: {
            uploaded: { $size: { $ifNull: ["$videos", []] } },
            youtube: { $size: { $ifNull: ["$youtube_urls", []] } },
          },
        },
        {
          $group: {
            _id: null,
            albums: { $sum: 1 },
            uploadedVideos: { $sum: "$uploaded" },
            youtubeVideos: { $sum: "$youtube" },
          },
        },
      ]),

      Abstract.countDocuments(),
      Executive.countDocuments(),
      Committee.countDocuments(),
      BoardMember.countDocuments(),
      ExecutiveType.countDocuments(),
    ]);

    // Member totals come from the Excel registration list (the source of
    // truth for the members page), so the dashboard matches it exactly.
    const memberRows = await loadMembers();
    const totalMembers = memberRows.length;
    const newLast30Days = memberRows.filter(
      (m) => m.registeredAt && m.registeredAt.getTime() >= thirtyDaysAgo,
    ).length;

    const consentCounts = {
      granted: 0,
      revoked: 0,
      deleted: 0,
      expired: 0,
      notGiven: 0,
    };
    memberRows.forEach((m) => {
      if (m.consentStatus === "Granted") consentCounts.granted += 1;
      else if (m.consentStatus === "Revoked") consentCounts.revoked += 1;
      else if (m.consentStatus === "Deleted") consentCounts.deleted += 1;
      else if (m.consentStatus === "Expired") consentCounts.expired += 1;
      else consentCounts.notGiven += 1;
    });

    const normalize = (rows) =>
      rows
        .filter((row) => row._id !== null && row._id !== undefined && row._id !== "")
        .map((row) => ({
          label: String(row._id),
          count: row.count,
        }));

    const consentLogCounts = { GRANTED: 0, REVOKED: 0, DELETED: 0 };
    consentLogAgg.forEach((row) => {
      if (consentLogCounts[row._id] !== undefined) {
        consentLogCounts[row._id] = row.count;
      }
    });

    const grievanceByStatus = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 0 };
    grievanceAgg.forEach((row) => {
      if (grievanceByStatus[row._id] !== undefined) {
        grievanceByStatus[row._id] = row.count;
      }
    });

    const gallery = galleryAgg[0] || { albums: 0, images: 0 };
    const video = videoAgg[0] || {
      albums: 0,
      uploadedVideos: 0,
      youtubeVideos: 0,
    };

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      members: {
        total: totalMembers,
        newLast30Days: newLast30Days,
        countries: normalize(countries),
        specialities: normalize(specialities),
        plans: normalize(plans),
        consent: {
          granted: consentCounts.granted,
          revoked: consentCounts.revoked,
          deleted: consentCounts.deleted,
          expired: consentCounts.expired,
          notGiven: consentCounts.notGiven,
        },
      },
      consentLogs: {
        total: consentLogCounts.GRANTED + consentLogCounts.REVOKED + consentLogCounts.DELETED,
        ...consentLogCounts,
      },
      grievances: {
        total: grievanceTotal,
        byStatus: grievanceByStatus,
      },
      gallery: {
        albums: gallery.albums,
        images: gallery.images,
      },
      videoGallery: {
        albums: video.albums,
        uploadedVideos: video.uploadedVideos,
        youtubeVideos: video.youtubeVideos,
        totalVideos: video.uploadedVideos + video.youtubeVideos,
      },
      content: {
        abstracts: abstractCount,
        executives: executiveCount,
        committees: committeeCount,
        boardMembers: boardMemberCount,
        executiveTypes: executiveTypeCount,
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load website statistics.",
    });
  }
});

module.exports = router;
