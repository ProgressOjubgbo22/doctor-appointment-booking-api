const Redis = require("ioredis");
const logger = require("./logger");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// A single shared connection for caching / locks / idempotency (BullMQ needs
// its own dedicated connections and creates those separately in queues/).
// maxRetriesPerRequest: null + lazyConnect keep this from crashing the whole
// API if Redis is temporarily unreachable - callers should treat cache /
// lock / idempotency helpers as best-effort, not a hard dependency.
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  lazyConnect: false,
  enableOfflineQueue: true,
});

redis.on("connect", () => logger.info("Redis connected", { url: REDIS_URL }));
redis.on("error", (err) => logger.error("Redis connection error", { error: err.message }));

module.exports = redis;
