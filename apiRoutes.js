const express = require("express");
const app = express();

//Import Routes
const cityRoute = require("./routes/city");
const authRoute = require("./routes/auth");
const roleRoute = require("./routes/role");
const errorLogRoute = require("./routes/errorreport");
const auditLogRoute = require("./routes/logbrowser");
const boardMemberRoute = require("./routes/boardmember");
const executiveTypeRoute = require("./routes/executive-type");
const executiveRoute = require("./routes/executive");
const galleryRoute = require("./routes/gallery");
const videoGalleryRoute = require("./routes/videogallery");
const registrationRoute = require("./routes/registration");
const pageContentRoute = require("./routes/pageContent");

module.exports = (app) => {
  //Route Middlewares
  app.use("/api/city", cityRoute);
  app.use("/api/user", authRoute);
  app.use("/api/roles", roleRoute);
  app.use("/api/elog/", errorLogRoute);
  app.use("/api/alog", auditLogRoute);
  app.use("/api/boardmember", boardMemberRoute);
  app.use("/api/executive-types", executiveTypeRoute);
  app.use("/api/executives", executiveRoute);
  app.use("/api/gallery", galleryRoute);
  app.use("/api/video-gallery", videoGalleryRoute);
  app.use("/api/registration", registrationRoute);
  app.use("/api/page-content", pageContentRoute);
};