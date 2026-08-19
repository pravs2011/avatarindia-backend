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
const committeeRoute = require("./routes/committee");
const abstractRoute = require("./routes/abstract");
const registrationRoute = require("./routes/registration");
const notificationRoute = require("./routes/notifications");
const grievanceRoute = require("./routes/grievance");
const pageContentRoute = require("./routes/pageContent");
const statsRoute = require("./routes/stats");
const emailTemplateRoute = require("./routes/emailTemplates");
const documentRoute = require("./routes/documents");
const popupRoute = require("./routes/popup");

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
  app.use("/api/committee", committeeRoute);
  app.use("/api/abstract", abstractRoute);
  app.use("/api/registration", registrationRoute);
  app.use("/api/notification", notificationRoute);
  app.use("/api/grievance", grievanceRoute);
  app.use("/api/page-content", pageContentRoute);
  app.use("/api/stats", statsRoute);
  app.use("/api/email-templates", emailTemplateRoute);
  app.use("/api/documents", documentRoute);
  app.use("/api/popup", popupRoute);
};
