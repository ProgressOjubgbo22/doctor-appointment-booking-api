const express = require("express");

const authRoutes = require("./auth.routes");
const patientRoutes = require("./patient.routes");
const { publicRouter: doctorPublicRoutes, privateRouter: doctorPrivateRoutes } = require("./doctor.routes");
const appointmentRoutes = require("./appointment.routes");
const prescriptionRoutes = require("./prescription.routes");
const medicalRecordRoutes = require("./medicalRecord.routes");
const paymentRoutes = require("./payment.routes");
const reviewRoutes = require("./review.routes");
const notificationRoutes = require("./notification.routes");
const specialtyRoutes = require("./specialty.routes");
const reportRoutes = require("./report.routes");
const auditRoutes = require("./audit.routes");
const adminRoutes = require("./admin.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/patients", patientRoutes);
router.use("/doctors", doctorPublicRoutes); // GET /api/doctors, /api/doctors/:id, etc (public)
router.use("/doctor", doctorPrivateRoutes); // doctor self-service (private)
router.use("/appointments", appointmentRoutes);
router.use("/prescriptions", prescriptionRoutes);
router.use("/medical-records", medicalRecordRoutes);
router.use("/payments", paymentRoutes);
router.use("/reviews", reviewRoutes);
router.use("/notifications", notificationRoutes);
router.use("/specialties", specialtyRoutes);
router.use("/reports", reportRoutes);
router.use("/audit-logs", auditRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
