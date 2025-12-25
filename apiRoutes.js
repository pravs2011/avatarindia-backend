const express = require("express");
const app = express();

//Import Routes
const cityRoute = require("./routes/city");
const authRoute = require("./routes/auth");
const roleRoute = require("./routes/role");
const errorLogRoute = require("./routes/errorreport");
const auditLogRoute = require("./routes/logbrowser");

module.exports = (app) => {
  //Route Middlewares
  app.use("/api/city", cityRoute);
  app.use("/api/user", authRoute);
  app.use("/api/roles", roleRoute);
  app.use("/api/elog/", errorLogRoute);
  app.use("/api/alog", auditLogRoute);
};
