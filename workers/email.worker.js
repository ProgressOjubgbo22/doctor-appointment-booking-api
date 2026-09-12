const { Worker } = require("bullmq");
const { createBullConnection } = require("../queues/queue");
const { EMAIL_QUEUE_NAME } = require("../queues/email.queue");
const sendEmail = require("../utils/sendEmail");
const logger = require("../config/logger");

/**
 * Consumes jobs from the "email-queue" and sends them with the existing,
 * unmodified sendEmail() (nodemailer) util. Retries/backoff are configured
 * on the queue side (see queues/queue.js) - this worker just needs to throw
 * on failure so BullMQ knows to retry the job.
 */
const startEmailWorker = () => {
  const worker = new Worker(
    EMAIL_QUEUE_NAME,
    async (job) => {
      const { to, subject, html } = job.data;
      await sendEmail({ to, subject, html });
    },
    { connection: createBullConnection(), concurrency: 5 }
  );

  worker.on("completed", (job) => {
    logger.info("Email job sent", { jobId: job.id, to: job.data?.to });
  });

  worker.on("failed", (job, err) => {
    logger.error("Email job failed", {
      jobId: job?.id,
      to: job?.data?.to,
      attemptsMade: job?.attemptsMade,
      error: err.message,
    });
  });

  worker.on("error", (err) => {
    logger.error("Email worker connection error", { error: err.message });
  });

  return worker;
};

module.exports = startEmailWorker;
