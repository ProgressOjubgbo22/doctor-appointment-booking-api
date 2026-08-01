const jwt = require("jsonwebtoken");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const User = require("../models/User");

// Verifies the access token from Authorization header or cookie and attaches req.user
const verifyJWT = asyncHandler(async (req, res, next) => {
  const token =
    req.cookies?.accessToken ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null);

  if (!token) {
    throw new ApiError(401, "Access token missing. Please log in.");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (error) {
    throw new ApiError(401, "Invalid or expired access token.");
  }

  const user = await User.findById(decoded.userId).select("-password");
  if (!user) throw new ApiError(401, "User no longer exists.");
  if (user.accountStatus !== "active") {
    throw new ApiError(403, `Account is ${user.accountStatus}. Contact support.`);
  }

  req.user = user;
  next();
});

module.exports = verifyJWT;
