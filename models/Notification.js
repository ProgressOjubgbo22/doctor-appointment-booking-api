const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: [
        "appointment_confirmation",
        "appointment_reminder",
        "appointment_cancellation",
        "reschedule_request",
        "payment_confirmation",
        "payment_received",
        "prescription_ready",
        "schedule_change",
        "new_appointment",
        "announcement",
        "account",
        "review",
      ],
      default: "announcement",
    },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
