const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    first_name: {
      type: String,
      required: true,
      min: 6,
      max: 255,
    },
    last_name: {
      type: String,
      required: false,
    },
    mobile: {
      type: String,
      // required: true,
      max: 20,
    },
    email: {
      type: String,
      required: true,
      max: 255,
      unique: true,
    },
    // employee_id: {
    //   type: String,
    //   required: true,
    //   max: 255,
    //   unique: true,
    // },
    department_id: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "Department",
    },
    password: {
      type: String,
      required: true,
      min: 6,
      max: 1024,
      select: false,
    },
    password_history: [{ type: String, select: false }],
    role: {
      type: String,
      required: false,
      max: 255,
    },
    role_id: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: "Role",
    },
    user_type: {
      type: String,
      required: false,
      max: 255,
    },
    account_status: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
