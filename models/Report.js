const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    medicalRecordId: { type: mongoose.Schema.Types.ObjectId, ref: "MedicalRecord" },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportType: { type: String, enum: ["lab", "imaging", "other"], default: "other" },
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Report", reportSchema);
