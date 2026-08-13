const mongoose = require("mongoose");

const registrationSchema = new mongoose.Schema(
  {
    sNo: { type: Number, required: true },
    registrationNo: { type: String, required: true, unique: true },
    mobileNo: { type: String, required: true },
    email: { type: String, required: true },
    title: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    fullName: { type: String, required: true },
    country: { type: String, default: "India" },
    speciality: { type: String },
    membershipPlan: { type: String, default: "Lifetime" },
    amount: { type: Number, default: 5000 },
    expiryDate: { type: String, default: "LifeTime" },
    registeredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Registration", registrationSchema);
