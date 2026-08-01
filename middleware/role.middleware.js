const ApiError = require("../utils/ApiError");

// Usage: authorizeRoles("admin"), authorizeRoles("doctor", "admin")
const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user) {
    throw new ApiError(401, "Not authenticated.");
  }
  if (!roles.includes(req.user.role)) {
    throw new ApiError(403, "You do not have permission to perform this action.");
  }
  next();
};

module.exports = authorizeRoles;
