const express = require("express");

const doctorController = require("../controllers/doctor.controller");
const complaintController = require("../controllers/complaint.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const upload = require("../middleware/upload.middleware");

const {
  updateDoctorSchema, consultationFeeSchema, availabilitySchema, unavailableDateSchema,
} = require("../validators/doctor.validator");
const { reportSchema } = require("../validators/complaint.validator");

const router = express.Router();

// // ---- Public browsing routes (mounted at /api/doctors) ----
const publicRouter = express.Router();
publicRouter.get("/search", doctorController.searchDoctors);
publicRouter.get("/", doctorController.listDoctors);
publicRouter.get("/:id", doctorController.getDoctorById);
publicRouter.get("/:id/availability", doctorController.getDoctorAvailability);
publicRouter.get("/:id/reviews", doctorController.getDoctorReviews);
publicRouter.get("/:id/qualifications", doctorController.getDoctorQualifications);

// // ---- Doctor-only self-service routes (mounted at /api/doctor) ----
const privateRouter = express.Router();
privateRouter.use(verifyJWT, authorizeRoles("doctor"));

privateRouter.get("/profile", doctorController.getMyProfile);
privateRouter.patch("/profile", validate(updateDoctorSchema), doctorController.updateMyProfile);
privateRouter.patch("/consultation-fee", validate(consultationFeeSchema), doctorController.updateConsultationFee);
privateRouter.post("/profile-picture", upload.single("image"), doctorController.uploadProfilePicture);

privateRouter.post("/availability", validate(availabilitySchema), doctorController.addAvailability);
privateRouter.get("/availability", doctorController.getMyAvailability);
privateRouter.patch("/availability/:id", doctorController.updateAvailability);
privateRouter.delete("/availability/:id", doctorController.deleteAvailability);

privateRouter.post("/unavailable-dates", validate(unavailableDateSchema), doctorController.addUnavailableDate);

privateRouter.get("/dashboard", doctorController.getDashboard);

privateRouter.get("/patients", doctorController.getMyPatients);
privateRouter.get("/patients/:patientId", doctorController.getPatientHistory);
privateRouter.get("/patients/:patientId/dashboard", doctorController.getPatientDashboardForDoctor);
privateRouter.post("/patients/:patientId/report", validate(reportSchema), complaintController.reportPatient);

privateRouter.get("/reviews", doctorController.getMyReviews);
privateRouter.get("/my-reports", complaintController.getMyReports);

module.exports = { publicRouter, privateRouter };
