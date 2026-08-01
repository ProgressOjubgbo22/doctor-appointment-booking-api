const Notification = require("../models/Notification");

/**
 * Create an in-app notification for a user. Fails silently (logs only)
 * so a notification error never breaks the primary request flow.
 */
const createNotification = async ({ userId, title, message, type }) => {
  try {
    return await Notification.create({ userId, title, message, type });
  } catch (error) {
    console.error("Notification creation failed:", error.message);
    return null;
  }
};

module.exports = createNotification;
