require("dotenv").config();
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const User = require("../models/User");
const Specialty = require("../models/Specialty");

const DEFAULT_SPECIALTIES = [
  { name: "Cardiology", description: "Heart and cardiovascular system" },
  { name: "Dermatology", description: "Skin, hair, and nail conditions" },
  { name: "Pediatrics", description: "Medical care for infants, children, and adolescents" },
  { name: "Orthopedics", description: "Bones, joints, ligaments, and muscles" },
  { name: "General Medicine", description: "General adult primary care" },
  { name: "Neurology", description: "Brain, spinal cord, and nervous system" },
  { name: "Gynecology", description: "Women's reproductive health" },
  { name: "ENT", description: "Ear, nose, and throat" },
  { name: "Dentistry", description: "Oral and dental health" },
  { name: "Psychiatry", description: "Mental health and behavioral disorders" },
];

const seed = async () => {
  await connectDB();

  const adminEmail = process.env.ADMIN_EMAIL || "admin@citycarehospital.com";
  const existingAdmin = await User.findOne({ email: adminEmail });

  if (!existingAdmin) {
    await User.create({
      firstName: "System",
      lastName: "Administrator",
      email: adminEmail,
      password: process.env.ADMIN_PASSWORD || "Admin@12345",
      role: "admin",
      accountStatus: "active",
      isEmailVerified: true,
    });
    console.log(`Admin account created: ${adminEmail}`);
  } else {
    console.log("Admin account already exists, skipping.");
  }

  for (const specialty of DEFAULT_SPECIALTIES) {
    const exists = await Specialty.findOne({ name: specialty.name });
    if (!exists) await Specialty.create(specialty);
  }
  console.log("Default specialties seeded.");

  await mongoose.connection.close();
  console.log("Seeding complete.");
  process.exit(0);
};

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
