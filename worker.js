require("dotenv").config();

const connectDB = require("./config/db");
const logger = require("./config/logger");
const startEmailWorker = require("./workers/email.worker");

/**
 * Background job runner. Kept as a separate process from the HTTP API
 * (server.js) - the standard BullMQ deployment pattern - so a burst of
 * queued jobs (or a slow SMTP provider) never competes with request
 * handling threads. Run alongside the API with:
 *
 *   npm start     # HTTP API
 *   npm run worker  # background job processor
 */
const startWorkers = async () => {
  await connectDB(); // workers need DB access too (e.g. for future job types)

  const emailWorker = startEmailWorker();
  logger.info("Background worker process started (email-queue).");

  const shutdown = async (signal) => {
    logger.info(`${signal} received. Shutting down worker gracefully.`);
    await emailWorker.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (err) => {
    logger.error("Unhandled Rejection in worker process", { error: err.message, stack: err.stack });
  });
};

startWorkers();
