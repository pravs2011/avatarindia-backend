const mongoose = require("mongoose");

// Holds a registration form submission in "pending payment" state. The real
// Registration member is only created after the Razorpay payment signature is
// verified (verify-payment endpoint or webhook). This keeps failed/abandoned
// payments from producing member records.
const pendingRegistrationSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    registrationNo: { type: String, default: "" },
    sNo: { type: Number },
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
    hospitalName: { type: String, default: "" },
    designation: { type: String, default: "" },
    membershipPlan: { type: String, default: "Lifetime" },
    amount: { type: Number, default: 5000 },
    // When the payment was created / last attempted (for cleanup of stale rows)
    createdAt: { type: Date, default: Date.now },
    // Set once the payment is captured and the member is created
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "PendingRegistration",
  pendingRegistrationSchema,
);
