const router = require("express").Router();
const BoardMember = require("../models/BoardMember");
const verify = require("./verifyToken");
const { createLog } = require("./logreport");

module.exports = router;
