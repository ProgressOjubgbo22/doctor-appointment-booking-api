const express = require("express");

const adminController = require("../controllers/admin.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");

const {
  createDoctorSchema, suspendSchema, announcementSchema,
  adminCreateAppointmentSchema, reassignAppointmentSchema,
} = require("../validators/admin.validator");
const { rescheduleAppointmentSchema } = require("../validators/appointment.validator");

const router = express.Router();
router.use(verifyJWT, authorizeRoles("admin"));

router.get("/dashboard", adminController.getDashboard);

// // Patients
router.get("/patients", adminController.getPatients);
router.get("/patients/:id", adminController.getPatientById);
router.patch("/patients/:id", adminController.updatePatient);
router.patch("/patients/:id/suspend", validate(suspendSchema), adminController.suspendPatient);
router.patch("/patients/:id/deactivate", adminController.deactivatePatient);
router.patch("/patients/:id/activate", adminController.activatePatient);
router.get("/patients/:id/dashboard", adminController.getPatientDashboardAdmin);

// // Doctors
router.post("/doctors", validate(createDoctorSchema), adminController.createDoctor);
router.get("/doctors", adminController.getDoctors);
router.get("/doctors/:id", adminController.getDoctorByIdAdmin);
router.get("/doctors/:id/performance", adminController.getDoctorPerformance);
router.patch("/doctors/:id", adminController.updateDoctorAdmin);
router.patch("/doctors/:id/approve", adminController.approveDoctor);
router.patch("/doctors/:id/verify", adminController.verifyDoctor);
router.patch("/doctors/:id/suspend", validate(suspendSchema), adminController.suspendDoctor);
router.patch("/doctors/:id/activate", adminController.activateDoctor);
router.delete("/doctors/:id", adminController.deleteDoctor);

// // Appointments
router.get("/appointments", adminController.getAllAppointments);
router.post("/appointments", validate(adminCreateAppointmentSchema), adminController.createAppointmentAdmin);
router.patch("/appointments/:id", adminController.updateAppointmentAdmin);
router.patch("/appointments/:id/cancel", adminController.cancelAppointmentAdmin);
router.patch("/appointments/:id/reschedule", validate(rescheduleAppointmentSchema), adminController.rescheduleAppointmentAdmin);
router.patch("/appointments/:id/reassign", validate(reassignAppointmentSchema), adminController.reassignAppointment);

// // Announcements
router.post("/notifications", validate(announcementSchema), adminController.sendAnnouncement);

module.exports = router;
