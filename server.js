const dotenv = require("dotenv");
dotenv.config();

const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const morgan = require("morgan");

const setupRoute = require("./apiRoutes");
const paymentWebhookRouter = require("./routes/paymentWebhook");

const app = express();

// Database Initialization
mongoose.set("strictQuery", false);
mongoose.connect(process.env.DATABASE_URL);
const db = mongoose.connection;
db.on("error", (err) => console.log("Database connection error:", err));
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

// Enable CORS for all incoming client origins & headers
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
    exposedHeaders: ["auth-token", "Authorization", "Content-Disposition"],
  }),
);

app.set("trust proxy", false);

// Enable secure headers with relaxed cross-origin policies for third-party embeds (Razorpay & YouTube)
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // Managed by custom CSP middleware below
  }),
);

// Reduce Fingerprinting
app.disable("x-powered-by");
app.use(helmet.hidePoweredBy());

// HTTP Logger morgan
app.use(morgan("tiny"));

// Middleware
// Razorpay webhook must see the raw body for signature verification — mount
// before express.json() so the body is not consumed by the JSON parser.
app.use(
  "/api/registration/payment-webhook",
  express.raw({ type: "application/json" }),
  paymentWebhookRouter,
);
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

// Enable Public Folder
app.use(express.static("./public"));
// Catch-all static route
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' * https://checkout.razorpay.com https://api.razorpay.com; " +
      "connect-src 'self' * https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://lumberjack-cx.razorpay.com https://*.razorpay.com https://www.youtube.com; " +
      "img-src * 'self' data: blob: https: http:; " +
      "frame-src * 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com https://www.youtube.com https://www.youtube-nocookie.com; " +
      "style-src * 'self' 'unsafe-inline' https:; " +
      "font-src * 'self' data: https:;",
  );
  res.removeHeader("Cross-Origin-Embedder-Policy");
  next();
});

// Route Middlewares
setupRoute(app);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("An error occurred:", err);

  if (res.headersSent) {
    return next(err);
  }

  const status = err && err.code === "LIMIT_FILE_SIZE" ? 413 : 500;
  res.status(status).json({
    success: false,
    error: (err && err.message) || "Internal server error",
  });
});

// Helper to find and load valid SSL certificates
const loadSSLCredentials = () => {
  if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    try {
      console.log(
        `Loading SSL from custom paths: ${process.env.SSL_CERT_PATH}`,
      );
      return {
        key: fs.readFileSync(process.env.SSL_KEY_PATH, "utf8"),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH, "utf8"),
        ca: process.env.SSL_CA_PATH
          ? fs.readFileSync(process.env.SSL_CA_PATH, "utf8")
          : undefined,
      };
    } catch (e) {
      console.warn("Could not load SSL from custom env paths:", e.message);
    }
  }

  const candidateDirs = [
    process.env.SSL_CERT_DIR,
    "/etc/letsencrypt/live/avatarindia.org",
    "/etc/letsencrypt/live/www.avatarindia.org",
    "/etc/letsencrypt/live/avatarindia.softedgeappstore.in",
  ].filter(Boolean);

  for (const dir of candidateDirs) {
    try {
      const keyPath = path.join(dir, "privkey.pem");
      const certPath = path.join(dir, "cert.pem");
      const caPath = path.join(dir, "chain.pem");

      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        console.log(`Loading SSL certificate from ${dir}`);
        return {
          key: fs.readFileSync(keyPath, "utf8"),
          cert: fs.readFileSync(certPath, "utf8"),
          ca: fs.existsSync(caPath)
            ? fs.readFileSync(caPath, "utf8")
            : undefined,
        };
      }
    } catch (e) {
      // Continue searching next directory
    }
  }

  console.warn("⚠️ No SSL certificates found in candidate paths.");
  return null;
};

const credentials = loadSSLCredentials();
const PORT_PRODUCTION = Number(process.env.PRODUCTION_PORT || 4089);
const HTTP_PORT = Number(process.env.HTTP_PORT || 3030);

// Start HTTP server
const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, () => {
  console.log(`HTTP Server running on port ${HTTP_PORT}`);
});

// Start HTTPS server if certificates exist
if (credentials && credentials.key && credentials.cert) {
  try {
    const httpsServer = https.createServer(credentials, app);
    httpsServer.listen(PORT_PRODUCTION, () => {
      console.log(`HTTPS Server running on port ${PORT_PRODUCTION}`);
    });
  } catch (err) {
    console.error("Failed to start HTTPS server:", err.message);
  }
} else {
  console.log(
    `HTTPS server skipped (no valid SSL certificates found). HTTP server active on port ${HTTP_PORT}.`,
  );
}
