const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_TOKEN_SECRET || "avatarindia-local-secret";

// Verifies a member's OTP-login token and attaches req.member.
const verifyMembershipToken = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.member = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Session expired or invalid.",
    });
  }
};

module.exports = verifyMembershipToken;
