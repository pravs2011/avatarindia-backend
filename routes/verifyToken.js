const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
  //const token = req.header('auth-token');

  let token;
  if (req.headers.authorization) {
    token = req.headers.authorization.split(" ")[1];
  }

  // res.send(token);

  if (!token) return res.status(401).send("Access Denied!");

  try {
    const verified = jwt.verify(token, process.env.JWT_TOKEN_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).send({ message: "Invalid Session / Token", token: false });
  }
};
