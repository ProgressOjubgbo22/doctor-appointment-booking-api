const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    medicalRecordId: { type: mongoose.Schema.Types.ObjectId, ref: "MedicalRecord" },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    medicationName: { type: String, required: true },
    dosage: { type: String, required: true },
    frequency: { type: String, required: true },
    duration: { type: String, required: true },
    instructions: { type: String, default: "" },
    status: { type: String, enum: ["active", "completed", "cancelled"], default: "active" },
    viewedByPatient: { type: Boolean, default: false },
    viewedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Prescription", prescriptionSchema);
