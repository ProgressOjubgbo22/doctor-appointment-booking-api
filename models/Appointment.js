const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    appointmentDate: { type: String, required: true }, // YYYY-MM-DD
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true }, // HH:mm
    reasonForVisit: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "checked_in",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
        "rescheduled",
      ],
      default: "pending",
    },
    cancelReason: { type: String, default: "" },
    checkedInAt: { type: Date },
    completedAt: { type: Date },
    noShowAt: { type: Date },
    createdBy: {
      type: String,
      enum: ["patient", "doctor", "admin"],
      default: "patient",
    },
    isFollowUp: { type: Boolean, default: false },
    parentAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
  },
  { timestamps: true }
);

appointmentSchema.index({ doctorId: 1, appointmentDate: 1, startTime: 1 });

module.exports = mongoose.model("Appointment", appointmentSchema);
