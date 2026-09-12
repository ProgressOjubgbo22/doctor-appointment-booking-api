const redis = require("../config/redis");
const logger = require("../config/logger");

/**
 * Cache-aside helper used for read-heavy, rarely-changing public endpoints
 * (e.g. doctor listings/profiles). All operations are best-effort: any
 * Redis error is logged and swallowed so caching can never break a request -
 * worst case we just fall back to hitting MongoDB directly.
 */
const getCache = async (key) => {
  try {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error("Cache GET failed", { key, error: error.message });
    return null;
  }
};

const setCache = async (key, value, ttlSeconds = 300) => {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    logger.error("Cache SET failed", { key, error: error.message });
  }
};

const deleteCache = async (keyOrPattern) => {
  try {
    if (keyOrPattern.includes("*")) {
      const keys = await redis.keys(keyOrPattern);
      if (keys.length) await redis.del(...keys);
    } else {
      await redis.del(keyOrPattern);
    }
  } catch (error) {
    logger.error("Cache DEL failed", { keyOrPattern, error: error.message });
  }
};

/**
 * Wraps a DB-fetching function with cache-aside semantics:
 * try cache -> miss -> run fetchFn -> populate cache -> return.
 */
const withCache = async (key, ttlSeconds, fetchFn) => {
  const cached = await getCache(key);
  if (cached !== null) return { data: cached, fromCache: true };

  const data = await fetchFn();
  await setCache(key, data, ttlSeconds);
  return { data, fromCache: false };
};

module.exports = { getCache, setCache, deleteCache, withCache };
