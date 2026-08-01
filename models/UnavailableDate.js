const mongoose = require("mongoose");

const unavailableDateSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    reason: { type: String, default: "" },
  },
  { timestamps: true }
);

unavailableDateSchema.index({ doctorId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("UnavailableDate", unavailableDateSchema);
