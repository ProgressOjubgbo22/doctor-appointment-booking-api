const { Queue, QueueEvents } = require("bullmq");
const Redis = require("ioredis");
const logger = require("../config/logger");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// BullMQ requires its own ioredis connection(s) (it manages blocking
// commands internally) - separate from config/redis.js, which is used for
// caching/locks/idempotency.
const createBullConnection = () =>
  new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 }, // 2s, 4s, 8s
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const queues = {};

/**
 * Returns a singleton BullMQ Queue for the given name, created lazily so a
 * missing/unreachable Redis instance doesn't crash the whole API at boot -
 * it only affects the specific feature (emails, reports, etc.) that tries
 * to enqueue a job.
 */
const getQueue = (name) => {
  if (!queues[name]) {
    const queue = new Queue(name, {
      connection: createBullConnection(),
      defaultJobOptions,
    });

    const events = new QueueEvents(name, { connection: createBullConnection() });
    events.on("failed", ({ jobId, failedReason }) => {
      logger.error(`Job failed in queue "${name}"`, { jobId, failedReason });
    });
    events.on("completed", ({ jobId }) => {
      logger.debug(`Job completed in queue "${name}"`, { jobId });
    });

    queues[name] = queue;
  }
  return queues[name];
};

module.exports = { getQueue, createBullConnection, defaultJobOptions };
