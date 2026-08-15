const mongoose = require("mongoose");

const registrationSchema = new mongoose.Schema(
  {
    sNo: { type: Number, required: true },
    registrationNo: { type: String, required: true, unique: true },
    mobileNo: { type: String, required: true },
    email: { type: String, required: true },
    title: { type: String, default: "" },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    fullName: { type: String, required: true },
    country: { type: String, default: "India" },
    speciality: { type: String },
    hospitalName: { type: String, default: "" },
    designation: { type: String, default: "" },
    membershipPlan: { type: String, default: "Lifetime" },
    amount: { type: Number, default: 5000 },
    expiryDate: { type: String, default: "LifeTime" },
    registeredAt: { type: Date, default: Date.now },
    consent: { type: Boolean, default: false },
    consentGivenAt: { type: Date, default: null },
    consentRevokedAt: { type: Date, default: null },
    consentDeletedAt: { type: Date, default: null },
    // DPDP consent duration - when the granted consent stops being valid
    consentExpiresAt: { type: Date, default: null },
    otpHash: { type: String, default: "" },
    otpExpiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Registration", registrationSchema);
