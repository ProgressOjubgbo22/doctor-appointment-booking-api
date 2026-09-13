const crypto = require("crypto");
const redis = require("../config/redis");
const ApiError = require("./ApiError");
const logger = require("../config/logger");

/**
 * Minimal distributed lock (SET key value NX PX ttl) used to serialize
 * concurrent requests that touch the same doctor time-slot - e.g. two
 * patients hitting POST /api/appointments for the same doctor/date/time at
 * the same instant. Each caller gets a random token so it can only release
 * the lock it actually holds (avoids one request releasing another's lock
 * after its own TTL expired).
 *
 * This is a pragmatic single-instance lock (not a full Redlock across a
 * Redis cluster) which is enough here because it's a defense-in-depth layer
 * on top of the MongoDB transaction + unique index, not the only safeguard
 * against double-booking.
 */
const acquireLock = async (key, ttlMs = 5000) => {
  const token = crypto.randomBytes(16).toString("hex");
  try {
    const result = await redis.set(key, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  } catch (error) {
    logger.error("Lock acquisition failed, proceeding without lock", { key, error: error.message });
    return "REDIS_UNAVAILABLE"; // fail-open: don't block bookings if Redis is down
  }
};

const releaseLock = async (key, token) => {
  if (!token || token === "REDIS_UNAVAILABLE") return;
  // Lua script ensures we only delete the key if we still own it.
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.eval(script, 1, key, token);
  } catch (error) {
    logger.error("Lock release failed", { key, error: error.message });
  }
};

/**
 * Runs fn() while holding a lock on `key`. Throws a 409 ApiError if the
 * lock could not be acquired within the retry window (i.e. another request
 * is actively booking the same slot right now).
 */
const withLock = async (key, fn, { ttlMs = 5000, retries = 5, retryDelayMs = 150 } = {}) => {
  let token = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    token = await acquireLock(key, ttlMs);
    if (token) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  if (!token) {
    throw new ApiError(409, "This slot is currently being booked by someone else. Please try again in a moment.");
  }

  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
};

module.exports = { withLock, acquireLock, releaseLock };
