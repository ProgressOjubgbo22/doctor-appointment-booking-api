const logger = require("../config/logger");

/**
 * Retries an async operation with exponential backoff. Used around calls to
 * third-party services (Stripe, Cloudinary) that can fail transiently
 * (network blips, rate limits) - separate from BullMQ's job-level retries,
 * which are for background work, not synchronous request-time calls.
 *
 * @param {Function} fn - async function to run
 * @param {Object} opts
 * @param {number} opts.retries - max retry attempts (not counting the first try)
 * @param {number} opts.baseDelayMs - initial backoff delay
 * @param {Function} opts.shouldRetry - (error) => boolean, decide whether an error is retryable
 */
const withRetry = async (fn, { retries = 2, baseDelayMs = 300, shouldRetry = () => true, label = "operation" } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries;
      if (isLastAttempt || !shouldRetry(error)) {
        logger.error(`${label} failed after ${attempt + 1} attempt(s)`, { error: error.message });
        throw error;
      }
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn(`${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
        error: error.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

module.exports = withRetry;
