const express = require("express");

const appointmentController = require("../controllers/appointment.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const idempotency = require("../middleware/idempotency.middleware");

const {
  createAppointmentSchema, rescheduleAppointmentSchema, cancelAppointmentSchema, rejectAppointmentSchema, createFollowUpSchema,
} = require("../validators/appointment.validator");

const router = express.Router();

router.use(verifyJWT);

// Idempotency-Key support: a client retry (timeout/double submit) with the
// same key returns the original booking response instead of creating a
// duplicate appointment.
router.post("/", authorizeRoles("patient"), idempotency(), validate(createAppointmentSchema), appointmentController.createAppointment);
router.get("/", authorizeRoles("patient", "doctor", "admin"), appointmentController.getAppointments);
router.get("/:id", authorizeRoles("patient", "doctor", "admin"), appointmentController.getAppointmentById);

router.patch("/:id/reschedule", authorizeRoles("patient", "doctor"), validate(rescheduleAppointmentSchema), appointmentController.rescheduleAppointment);
router.patch("/:id/cancel", authorizeRoles("patient", "doctor"), validate(cancelAppointmentSchema), appointmentController.cancelAppointment);

router.patch("/:id/accept", authorizeRoles("doctor"), appointmentController.acceptAppointment);
router.patch("/:id/reject", authorizeRoles("doctor"), validate(rejectAppointmentSchema), appointmentController.rejectAppointment);
router.patch("/:id/check-in", authorizeRoles("doctor", "admin"), appointmentController.checkInAppointment);
router.patch("/:id/complete", authorizeRoles("doctor"), appointmentController.completeAppointment);
router.patch("/:id/no-show", authorizeRoles("doctor"), appointmentController.markNoShow);

router.post("/:id/follow-up", authorizeRoles("patient", "doctor"), idempotency(), validate(createFollowUpSchema), appointmentController.createFollowUpAppointment);
router.get("/:id/follow-ups", authorizeRoles("patient", "doctor", "admin"), appointmentController.getFollowUps);

module.exports = router;
