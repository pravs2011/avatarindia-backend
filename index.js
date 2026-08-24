const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const express = require("express");
const myParser = require("body-parser");
const fileupload = require("express-fileupload");
const cors = require("cors");
const app = express();
const mongoose = require("mongoose");
const pino = require("pino");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const setupRoute = require("./apiRoutes");
const paymentWebhookRouter = require("./routes/paymentWebhook");
const { startMemberBackupScheduler } = require("./services/memberBackup");

const loginlimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 10 minutes
  max: 5, // Limit each IP to 5 requests per `window` (here, per 10 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

//const logger = pino();
const logFile = fs.createWriteStream("./logs/app.log");
const logger = pino(
  {
    level: "debug",
    prettyPrint: false,
    levelVal: 20,
    customLevels: {
      debug: 10,
    },
    formatters: {
      level(label, number) {
        return { level: label };
      },
    },
    enabled: (name, level) => level >= this.levelVal,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  logFile,
);

//Initiate Environment Variable
dotenv.config();

//Connect DB
mongoose.set("strictQuery", true);
//Database Initalization
mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true });
const db = mongoose.connection;
db.on("error", (err) => console.log(err));
db.once("open", async () => {
  console.log("Connected to database");
  try {
    const coll = db.collection("pendingregistrations");
    const indexes = await coll.indexes();
    if (indexes.some((idx) => idx.name === "registrationNo_1")) {
      await coll.dropIndex("registrationNo_1");
      console.log(
        "Dropped legacy registrationNo_1 index from pendingregistrations",
      );
    }
  } catch (err) {
    // Ignore if collection or index doesn't exist
  }
});

//Enable CORS for all incoming client origins & headers
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
      "auth-token",
    ],
    exposedHeaders: ["auth-token", "Authorization"],
  }),
);

app.set("trust proxy", false);

//Enable secure headers with relaxed cross-origin embedder policy for Razorpay & YouTube
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
    frameguard: false,
  }),
);

//Reduce Fingerprinting
app.disable("x-powered-by");
app.use(helmet.hidePoweredBy());

//http Logger morgan
app.use(morgan("tiny"));

//Middleware
// Razorpay webhook must see the raw body for signature verification — mount
// before express.json() so the body is not consumed by the JSON parser.
app.use(
  "/api/registration/payment-webhook",
  express.raw({ type: "application/json" }),
  paymentWebhookRouter,
);
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

//Enable Public Folder
// Serve the public folder at root (matches server.js) so uploaded
// files (profile images, gallery images/videos) resolve in local dev
app.use(express.static("./public"));

// Now, setup express to serve the static files and use the catch-all route
app.use("/web", express.static(path.join(__dirname, "./public")));
app.use("/uploads", express.static(path.join(__dirname, "./uploads")));

app.use((req, res, next) => {
  res.setHeader(
    "Access-Control-Expose-Headers",
    "auth-token, Authorization, Content-Disposition",
  );
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' * data: blob:; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' * https://checkout.razorpay.com https://api.razorpay.com https://cdn.razorpay.com; " +
      "connect-src 'self' * https://api.razorpay.com https://checkout.razorpay.com https://cdn.razorpay.com https://lumberjack.razorpay.com https://lumberjack-cx.razorpay.com https://*.razorpay.com https://www.youtube.com; " +
      "img-src * 'self' data: blob: https: http:; " +
      "frame-src 'self' blob: https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com https://www.youtube.com https://www.youtube-nocookie.com; " +
      "style-src * 'self' 'unsafe-inline' https:; " +
      "font-src * 'self' data: https:;",
  );
  res.removeHeader("Cross-Origin-Embedder-Policy");
  res.removeHeader("X-Frame-Options");
  next();
});

//Login Limiter Comment to disable
//app.use("/api/user/login", loginlimiter);

//Logging middleware
// Middleware that logs incoming requests
app.use((req, res, next) => {
  logger.info("Incoming request:", req.method, req.url);
  next();
});

//Route Middlewares
setupRoute(app);
startMemberBackupScheduler();

// Error handling middleware
app.use((err, req, res, next) => {
  //console.error(err);
  logger.error("An error occurred:", err);

  // Don't override responses that have already been sent
  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({ message: "Internal server error" });
});

// Handle 404 errors
app.use((req, res, next) => {
  res.status(404).json({ error: "404 - Not Found" });
});

app.listen(3030, () => console.log("Server has started on PORT 3030"));
