const { StatusCodes } = require("http-status-codes");

const Notification = require("../models/Notification");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

// GET /api/notifications
const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 });
  const unreadCount = await Notification.countDocuments({ userId: req.user._id, isRead: false });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { notifications, unreadCount }, "Notifications fetched."));
});

// PATCH /api/notifications/:id/read
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);
  if (!notification) throw new ApiError(404, "Notification not found.");
  if (String(notification.userId) !== String(req.user._id)) throw new ApiError(403, "Not your notification.");

  notification.isRead = true;
  notification.readAt = new Date();
  await notification.save();

  return res.status(StatusCodes.OK).json(new ApiResponse(200, notification, "Notification marked as read."));
});

// PATCH /api/notifications/read-all
const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { userId: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { modifiedCount: result.modifiedCount }, "All notifications marked as read."));
});

module.exports = { getNotifications, markAsRead, markAllAsRead };