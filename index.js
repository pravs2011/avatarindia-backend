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
  logFile
);

//Initiate Environment Variable
dotenv.config();

//Connect DB
mongoose.set("strictQuery", true);
//Database Initalization
mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true });
const db = mongoose.connection;
db.on("error", (err) => console.log(err));
db.once("open", () => console.log("Connected to database"));

app.use(cors());

// app.use(myParser);

//Enable cors
app.use(
  cors({
    origin: "http://192.168.29.52:3006",
  })
);
app.use(
  cors({
    origin: "http://localhost:3006",
  })
);

app.set("trust proxy", false);

//Enable secure headers
//app.use(helmet());

//Reduce Fingerprinting
app.disable("x-powered-by");
//app.use(helmet.hidePoweredBy());

//http Logger morgan
app.use(morgan("tiny"));

//Middleware
//app.use(express.json());
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));
// Remove fileupload middleware as it conflicts with multer
// app.use(fileupload());

// //Enable Public Folder
// app.use(express.static("./public"));

// Now, setup express to serve the static files and use the catch-all route
app.use("/web", express.static(path.join(__dirname, "./public")));
app.use("/uploads", express.static(path.join(__dirname, "./uploads")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Expose-Headers", "auth-token");
  next();
});

app.use(function (req, res, next) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'http://localhost:3006' 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; frame-src 'self'"
  );
  next();
});

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
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

app.listen(3020, () => console.log("Server has started on PORT 3020"));
