const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ─────────────────────────────────────────────
//  Verify Bearer Token
//  Attaches req.user on success
// ─────────────────────────────────────────────

const protect = async (req, res, next) => {
  try {
    // 1) Read token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "Not authorized – no token provided" });
    }

    const token = authHeader.split(" ")[1];

    // 2) Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3) Find user and attach to request
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized – invalid token" });
  }
};

// ─────────────────────────────────────────────
//  Allow Guest Access
//  If token is present → attach user
//  If no token → continue as guest (req.user = null)
// ─────────────────────────────────────────────

const allowGuest = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id);
    }
  } catch {
    // Token invalid – just continue as guest
  }
  next();
};

// ─────────────────────────────────────────────
//  Role-Based Access
//  Usage: authorize("admin")
//         authorize("admin", "user")
// ─────────────────────────────────────────────

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Forbidden – insufficient permissions" });
    }
    next();
  };
};

module.exports = { protect, allowGuest, authorize };
