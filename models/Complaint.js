const mongoose = require("mongoose");

const REPORT_REASONS = [
  "unprofessional_conduct",
  "no_show",
  "misdiagnosis",
  "poor_communication",
  "billing_issue",
  "harassment",
  "safety_concern",
  "other",
];

const complaintSchema = new mongoose.Schema(
  {
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reporterRole: { type: String, enum: ["patient", "doctor"], required: true },
    reportedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportedRole: { type: String, enum: ["patient", "doctor"], required: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    description: { type: String, required: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ["pending", "under_review", "resolved", "dismissed"],
      default: "pending",
    },
    adminNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

complaintSchema.index({ reportedUserId: 1, status: 1 });

module.exports = mongoose.model("Complaint", complaintSchema);
module.exports.REPORT_REASONS = REPORT_REASONS;
