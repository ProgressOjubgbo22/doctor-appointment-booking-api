const express = require("express");

const notificationController = require("../controllers/notification.controller");
const verifyJWT = require("../middleware/auth.middleware");

const router = express.Router();
router.use(verifyJWT);

router.get("/", notificationController.getNotifications);
router.patch("/read-all", notificationController.markAllAsRead);
router.patch("/:id/read", notificationController.markAsRead);

module.exports = router;
