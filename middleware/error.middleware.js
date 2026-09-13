const ApiError = require("../utils/ApiError");
const logger = require("../config/logger");

// 404 handler for unmatched routes
const notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
};

// Central error handler - every error in the app funnels through here
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";
  let errors = err.errors || [];

  // Mongoose bad ObjectId
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = `Duplicate value for field: ${field}`;
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    statusCode = 422;
    message = "Validation failed";
    errors = Object.values(err.errors).map((e) => ({ message: e.message }));
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  }
  if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
  }

  // Log every 5xx as an error (unexpected/internal) and every 4xx at a
  // quieter level (expected client-caused failures) so error.log stays
  // focused on things that actually need attention.
  if (statusCode >= 500) {
    logger.error(err.message, { stack: err.stack, statusCode, path: req.originalUrl, method: req.method });
  } else {
    logger.debug(`Handled ${statusCode}: ${message}`, { path: req.originalUrl, method: req.method });
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };
