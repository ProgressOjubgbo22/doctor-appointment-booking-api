const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    phoneNumber: { type: String, trim: true },
    profilePicture: { type: String, default: "" },
    role: { type: String, enum: ["patient", "doctor", "admin"], default: "patient" },
    isEmailVerified: { type: Boolean, default: false },
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "inactive", "pending"],
      default: "pending",
    },
    suspensionReason: { type: String, default: "" },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("User", userSchema);
