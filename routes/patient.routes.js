const express = require("express");

const patientController = require("../controllers/patient.controller");
const { uploadPatientReport } = require("../controllers/medicalRecord.controller");

const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const upload = require("../middleware/upload.middleware");

const { updatePatientSchema, emergencyContactSchema, addressSchema, updateEmergencyContactSchema, updateAddressSchema } = require("../validators/patient.validator");

const router = express.Router();

router.use(verifyJWT, authorizeRoles("patient"));

router.get("/profile", patientController.getProfile);
router.patch("/profile", validate(updatePatientSchema), patientController.updateProfile);
router.delete("/profile", patientController.deleteAccount);
router.post("/profile-picture", upload.single("image"), patientController.uploadProfilePicture);

router.get("/dashboard", patientController.getDashboard);
router.get("/medical-records", patientController.getMedicalRecords);
router.post("/reports", upload.single("file"), uploadPatientReport);
router.get("/prescriptions", patientController.getPrescriptions);

router.get("/appointments", patientController.getAppointments);
router.get("/upcoming-appointments", patientController.getUpcomingAppointments);

router.post("/emergency-contacts", validate(emergencyContactSchema), patientController.addEmergencyContact);
router.get("/emergency-contacts", patientController.getEmergencyContacts);
router.patch("/emergency-contacts/:id", validate(updateEmergencyContactSchema), patientController.updateEmergencyContact);
router.delete("/emergency-contacts/:id", patientController.deleteEmergencyContact);

router.post("/addresses", validate(addressSchema), patientController.addAddress);
router.get("/addresses", patientController.getAddresses);
router.patch("/addresses/:id", validate(updateAddressSchema), patientController.updateAddress);
router.delete("/addresses/:id", patientController.deleteAddress);

router.post("/favorites/:doctorId", patientController.addFavoriteDoctor);
router.delete("/favorites/:doctorId", patientController.removeFavoriteDoctor);

router.get("/doctors/:doctorId/history", patientController.getDoctorHistory);

module.exports = router;
