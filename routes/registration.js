const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const Registration = require("../models/Registration");

const EXCEL_PATH = path.resolve(
  __dirname,
  "../../send_email_to_registrants/registrations.xlsx"
);

// Helper function to append registration to Excel file
async function appendToExcel(data) {
  const workbook = new ExcelJS.Workbook();

  if (fs.existsSync(EXCEL_PATH)) {
    await workbook.xlsx.readFile(EXCEL_PATH);
  } else {
    // Create worksheet if file doesn't exist
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
    if (rowNumber === 1) return; // skip header
    const val = row.getCell(1).value;
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > maxSNo) {
      maxSNo = num;
    }
  });

  const nextSNo = maxSNo > 0 ? maxSNo + 1 : 168;
  const regNo = `AIS${String(nextSNo).padStart(4, "0")}`;

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(" ")[0]; // HH:mm:ss

  const titlePrefix =
    data.title && data.title !== "Select Title" ? `${data.title} ` : "";
  const fullName = `${titlePrefix}${data.firstName} ${data.lastName}`.trim();

  // Add row
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

// POST: Register user
router.post("/register", async (req, res) => {
  try {
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
    } = req.body;

    if (!mobileNo || !email || !firstName || !lastName || !title) {
      return res.status(400).json({
        success: false,
        message: "Please fill in all required fields.",
      });
    }

    // Append to Excel file
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

    // Attempt saving to MongoDB
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
        membershipPlan: membershipPlan || "Lifetime",
        amount: amount || 5000,
        expiryDate: "LifeTime",
      });
      await newRegistration.save();
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
        if (v.text) return v.text; // hyperlink
        if (v.formula) return v.result ?? ""; // formula cell
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

    const registrations = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const c = (i) => normalizeCell(row.getCell(i).value);
      const registrationNo = String(c(2) ?? "").trim();
      const fullName = String(c(3) ?? "").trim();
      // Skip fully-empty rows (xlsx rowCount includes trailing blanks)
      if (!registrationNo && !fullName) return;
      registrations.push({
        sNo: Number(c(1)) || 0,
        registrationNo,
        fullName,
        email: String(c(4) ?? "").trim(),
        mobileNo: String(c(5) ?? "").trim(),
        expiryDate: formatDate(c(6)),
        date: formatDate(c(7)),
        time: formatTime(c(8)),
      });
    });

    // Sort by S.No descending (newest first)
    registrations.sort((a, b) => b.sNo - a.sNo);

    return res.json({
      success: true,
      count: registrations.length,
      registrations,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
