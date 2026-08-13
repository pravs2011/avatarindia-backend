const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require("express");
const helmet = require("helmet");
const setupRoute = require("./apiRoutes");
const PORT_PRODUCTION = process.env.PRODUCTION_PORT || 4089;
// Certificate
const privateKey = fs.readFileSync(
  "/etc/letsencrypt/live/avatarindia.softedgeappstore.in/privkey.pem",
  "utf8"
);
const certificate = fs.readFileSync(
  "/etc/letsencrypt/live/avatarindia.softedgeappstore.in/cert.pem",
  "utf8"
);
const ca = fs.readFileSync(
  "/etc/letsencrypt/live/avatarindia.softedgeappstore.in/chain.pem",
  "utf8"
);

const credentials = {
  key: privateKey,
  cert: certificate,
  ca: ca,
};

// const dotenv = require("dotenv");
//const express = require("express");
const myParser = require("body-parser");
//const fileupload = require("express-fileupload");
const cors = require("cors");
const app = express();
const mongoose = require("mongoose");
const morgan = require("morgan");

//Initiate Environment Variable
dotenv.config();

//Connect DB
mongoose.set("strictQuery", true);
//Database Initalization
mongoose.connect(process.env.DATABASE_URL);
const db = mongoose.connection;
db.on("error", (err) => console.log(err));
db.once("open", () => console.log("Connected to database"));

//Strict Query is set to false
mongoose.set("strictQuery", false);

//Enable cors
app.use(cors());

//Enable cors

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://avatarindia.softedgeappstore.in",
    ],
  })
);

app.set("trust proxy", false);

//Enable secure headers
// app.use(helmet());
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

//Reduce Fingerprinting
app.disable("x-powered-by");
app.use(helmet.hidePoweredBy());

//http Logger morgan
app.use(morgan("tiny"));

//Middleware
//app.use(express.json());
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));
//app.use(fileupload());

// //Enable Public Folder
app.use(express.static("./public"));
// Now, setup express to serve the static files and use the catch-all route
app.use("/web", express.static(path.join(__dirname, "./public")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Expose-Headers", "auth-token");
  next();
});

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' https://avatarindia.softedgeappstore.in http://localhost:5173 https://i.ytimg.com https://img.youtube.com data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' https://www.youtube.com"
  );
  next();
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

//Route Middlewares
setupRoute(app);

//app.listen(3000, () => console.log("Server has started on PORT 3000"));
// Starting both http & https servers
const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);
/*
httpServer.listen(80, () => {
	console.log('HTTP Server running on port 80');
});
*/
httpsServer.listen(PORT_PRODUCTION, () => {
  console.log(`HTTPS Server running on port ${PORT_PRODUCTION}`);
});
