const mongoose = require("mongoose");

const availabilitySchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    dayOfWeek: {
      type: String,
      enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
      required: true,
    },
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true }, // HH:mm
    breakStartTime: { type: String },
    breakEndTime: { type: String },
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

availabilitySchema.index({ doctorId: 1, dayOfWeek: 1 }, { unique: true });

module.exports = mongoose.model("Availability", availabilitySchema);
