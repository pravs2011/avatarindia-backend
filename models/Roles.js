const mongoose = require("mongoose");

const rolesSchema = new mongoose.Schema(
  {
    role_name: {
      type: String,
      required: false,
      max: 255,
    },
    access_level: {
      type: String,
      required: false,
      max: 255,
    },
    // access_routes: [
    //   {
    //     route_name: {
    //       type: String,
    //       required: false,
    //       max: 255,
    //     },
    //   },
    // ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Role", rolesSchema);
