const mongoose = require("mongoose");
const logger = require("../config/logger");

let transactionsSupported = true; // flips to false the first time we detect a standalone Mongo instance

/**
 * Runs fn(session) inside a MongoDB session/transaction so multi-document
 * writes (e.g. creating an Appointment + its Payment record, or updating an
 * Appointment + its Payment on cancel) either all succeed or all roll back
 * together.
 *
 * MongoDB transactions require a replica set (or mongos) - a plain
 * standalone `mongod`, which is common in local dev, does not support them.
 * To keep this working out of the box in both environments, we detect that
 * specific failure once and fall back to running fn(null) without a session
 * (the individual writes still happen, just without atomicity) rather than
 * crashing every request. Production deployments (MongoDB Atlas, which is
 * always a replica set) get real transactions.
 */
const withTransaction = async (fn) => {
  if (!transactionsSupported) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (error) {
    const unsupported =
      /Transaction numbers are only allowed on a replica set member or mongos/i.test(error.message) ||
      /IllegalOperation/i.test(error.codeName || "");

    if (unsupported) {
      logger.warn(
        "MongoDB transactions are not supported by this deployment (standalone instance) - falling back to non-transactional writes. Use a replica set (e.g. MongoDB Atlas) in production for full atomicity."
      );
      transactionsSupported = false;
      return fn(null);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = withTransaction;
