const mongoose = require("mongoose");

const registrationSchema = new mongoose.Schema(
  {
    sNo: { type: Number, required: true },
    registrationNo: { type: String, required: true, unique: true },
    // Email / mobile are optional so members added via import or the admin
    // panel can exist without them (same as the legacy Excel list allowed).
    mobileNo: { type: String, default: "" },
    email: { type: String, default: "" },
    title: { type: String, default: "" },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    fullName: { type: String, required: true },
    country: { type: String, default: "India" },
    speciality: { type: String },
    educationalQualification: {
      type: String,
      enum: ["Bachelor's Degree", "Master's Degree", "Doctorate/Doctoral Degree", ""],
      default: "",
    },
    degreeCertificatePath: { type: String, default: "" },
    degreeCertificateName: { type: String, default: "" },
    degreeCertificateMimeType: { type: String, default: "" },
    degreeCertificateSize: { type: Number, default: 0 },
    membershipStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, default: "" },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewHistory: [
      {
        action: { type: String, enum: ["REAPPLIED", "APPROVED", "REJECTED"] },
        reason: { type: String, default: "" },
        reviewedAt: { type: Date, default: Date.now },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      },
    ],
    hospitalName: { type: String, default: "" },
    designation: { type: String, default: "" },
    membershipPlan: { type: String, default: "Lifetime" },
    amount: { type: Number, default: 5000 },
    // Razorpay payment fields. Records are created as "pending" when the
    // payment order is generated and flipped to "paid" once the signature
    // is verified (browser callback or webhook).
    paymentOrderId: { type: String, default: "" },
    paymentId: { type: String, default: "" },
    paymentSignature: { type: String, default: "" },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    refundStatus: {
      type: String,
      enum: ["NOT_REQUESTED", "PENDING", "PROCESSED", "FAILED"],
      default: "NOT_REQUESTED",
    },
    refundId: { type: String, default: "" },
    refundAmount: { type: Number, default: 0 },
    refundInitiatedAt: { type: Date, default: null },
    refundError: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    expiryDate: { type: String, default: "LifeTime" },
    // Registration date / time as shown on the members page and export
    date: { type: String, default: "" },
    time: { type: String, default: "" },
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
