const redis = require("../config/redis");
const logger = require("../config/logger");

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24h - long enough to cover client retries/timeouts

/**
 * Opt-in idempotency for POST endpoints that create money- or booking-
 * related side effects (appointments, payments) where a client retry
 * (network timeout, double-tap on submit) must not create a duplicate.
 *
 * Usage: client sends an `Idempotency-Key` header (any unique client-
 * generated string, typically a UUID) with the request. On first receipt we
 * run the handler as normal and cache its JSON response against that key.
 * On any later request with the same key + route + user we return the
 * cached response instead of re-running the handler.
 *
 * If no Idempotency-Key header is sent, the request just proceeds normally -
 * this middleware never blocks a request, it only deduplicates when asked.
 */
const idempotency = () => async (req, res, next) => {
  const idempotencyKey = req.headers["idempotency-key"];
  if (!idempotencyKey) return next();

  const cacheKey = `idempotency:${req.user?._id || "anon"}:${req.method}:${req.originalUrl}:${idempotencyKey}`;
  const lockKey = `${cacheKey}:lock`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const { statusCode, body } = JSON.parse(cached);
      res.setHeader("Idempotent-Replay", "true");
      return res.status(statusCode).json(body);
    }

    // Prevent two near-simultaneous requests with the same key both running
    // the handler before either has cached a response.
    const acquiredLock = await redis.set(lockKey, "1", "PX", 15000, "NX");
    if (!acquiredLock) {
      return res.status(409).json({
        success: false,
        message: "A request with this Idempotency-Key is already being processed.",
      });
    }
  } catch (error) {
    // Redis unavailable - fail open rather than blocking bookings/payments.
    logger.error("Idempotency check failed, proceeding without dedup", { error: error.message });
    return next();
  }

  // Wrap res.json to capture and cache the response once the handler finishes.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    redis
      .set(cacheKey, JSON.stringify({ statusCode: res.statusCode, body }), "EX", IDEMPOTENCY_TTL_SECONDS)
      .catch((error) => logger.error("Failed to cache idempotent response", { error: error.message }))
      .finally(() => redis.del(lockKey).catch(() => {}));
    return originalJson(body);
  };

  next();
};

module.exports = idempotency;
