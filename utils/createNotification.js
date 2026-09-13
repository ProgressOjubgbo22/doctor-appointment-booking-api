const Notification = require("../models/Notification");
const logger = require("../config/logger");

/**
 * Create an in-app notification for a user. Fails silently (logs only)
 * so a notification error never breaks the primary request flow.
 */
const createNotification = async ({ userId, title, message, type }) => {
  try {
    return await Notification.create({ userId, title, message, type });
  } catch (error) {
    logger.error("Notification creation failed", { error: error.message });
    return null;
  }
};

module.exports = createNotification;
