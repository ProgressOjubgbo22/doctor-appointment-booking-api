const mongoose = require("mongoose");

const medicalRecordSchema = new mongoose.Schema(
  {
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    diagnosis: { type: String, default: "" },
    symptoms: [{ type: String }],
    treatmentPlan: { type: String, default: "" },
    notes: { type: String, default: "" },
    followUpDate: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MedicalRecord", medicalRecordSchema);
