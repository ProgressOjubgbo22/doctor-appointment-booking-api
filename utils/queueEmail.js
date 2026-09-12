const { emailQueue } = require("../queues/email.queue");
const sendEmail = require("./sendEmail");
const logger = require("../config/logger");

/**
 * Same signature/contract as utils/sendEmail.js ({ to, subject, html }) so
 * existing call sites can swap the require() with no other changes. Instead
 * of blocking the HTTP request on an SMTP round trip, the email is handed
 * off to the "email-queue" BullMQ queue, which retries with exponential
 * backoff (see queues/queue.js) and is processed by workers/email.worker.js.
 *
 * If Redis/BullMQ is unavailable for any reason, we fail open and send the
 * email inline via the original sendEmail() so a broken queue never blocks
 * critical flows like registration or password resets.
 */
const queueEmail = async ({ to, subject, html }) => {
  try {
    await emailQueue.add(
      "send-email",
      { to, subject, html },
      { attempts: 5, backoff: { type: "exponential", delay: 3000 } }
    );
  } catch (error) {
    logger.error("Failed to enqueue email job, falling back to direct send", {
      to,
      subject,
      error: error.message,
    });
    try {
      await sendEmail({ to, subject, html });
    } catch (sendError) {
      // Matches the original sendEmail contract for its callers (register,
      // password reset, etc.): an email failure must never break the
      // primary request flow, it's only ever logged.
      logger.error("Fallback direct email send also failed", { to, subject, error: sendError.message });
    }
  }
};

module.exports = queueEmail;
