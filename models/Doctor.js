const mongoose = require("mongoose");

const doctorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    specialtyId: { type: mongoose.Schema.Types.ObjectId, ref: "Specialty", required: true },
    licenseNumber: { type: String, required: true, unique: true },
    qualification: [{ type: String }],
    yearsOfExperience: { type: Number, default: 0 },
    consultationFee: { type: Number, required: true, default: 0 },
    bio: { type: String, default: "" },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "suspended"],
      default: "pending",
    },
    verificationNotes: { type: String, default: "" },
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Doctor", doctorSchema);
