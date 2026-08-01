const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const apiRoutes = require("./routes/index");
const { handleStripeWebhook } = require("./controllers/payment.controller");
const { notFound, errorHandler } = require("./middleware/error.middleware");

const app = express();

// ---- Security & core middleware ----
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// ---- Stripe webhook (MUST be mounted with raw body BEFORE express.json()) ----
// Stripe signs the raw, unparsed request body - if express.json() runs first,
// the body is already parsed/re-serialized and signature verification fails.
// Lives in the payment controller (not the validated /api/payments router)
// since it's called by Stripe directly, not by an authenticated client.
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Global rate limiter (per-route limiters are applied additionally on auth routes)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", globalLimiter);

// ---- Health check ----
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---- API routes ----
app.use("/api", apiRoutes);

// ---- 404 + error handling ----
app.use(notFound);
app.use(errorHandler);

module.exports = app;