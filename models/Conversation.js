const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: "" },
  },
  { timestamps: true }
);

// One conversation thread per patient/doctor pair
conversationSchema.index({ patientId: 1, doctorId: 1 }, { unique: true });

module.exports = mongoose.model("Conversation", conversationSchema);
