const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ── Helper: create JWT ──
const signToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// ─────────────────────────────────────────────
//  POST /api/auth/register
//  Creates a new user account (role = "user")
// ─────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if email already taken
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const user = await User.create({ name, email, password, role: "user" });

    const token = signToken(user._id);
    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  POST /api/auth/login
//  Returns a Bearer token
// ─────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Please provide email and password" });
    }

    // +password to override select:false
    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = signToken(user._id);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  POST /api/auth/guest
//  Returns a token with guest role (no account needed)
// ─────────────────────────────────────────────
exports.guestLogin = async (req, res) => {
  try {
    // Create a temporary guest user (or find existing guest)
    const guestEmail = `guest_${Date.now()}@omnifind.temp`;
    const guest = await User.create({
      name: "Guest",
      email: guestEmail,
      password: "guest_no_login",
      role: "guest",
    });

    const token = signToken(guest._id);
    res.json({
      token,
      user: { id: guest._id, name: guest.name, role: guest.role },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────
//  GET /api/auth/me
//  Returns current user profile (needs token)
// ─────────────────────────────────────────────
exports.getMe = async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
};

// ─────────────────────────────────────────────
//  POST /api/auth/create-admin
//  Admin-only: create a new admin account
// ─────────────────────────────────────────────
exports.createAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const admin = await User.create({ name, email, password, role: "admin" });

    res.status(201).json({
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
