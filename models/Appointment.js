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

// Defense-in-depth against double-booking races: even if two requests slip
// past the application-level Redis lock + transaction check at the exact
// same instant, MongoDB itself will reject the second insert for the same
// doctor/date/time while an appointment in an "active" status already
// exists for that slot. Cancelled/completed/rejected slots are excluded via
// the partial filter so a slot can always be rebooked once freed up.
appointmentSchema.index(
  { doctorId: 1, appointmentDate: 1, startTime: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["pending", "confirmed", "checked_in", "in_progress"] },
    },
    name: "unique_active_slot_per_doctor",
  }
);

module.exports = mongoose.model("Appointment", appointmentSchema);
