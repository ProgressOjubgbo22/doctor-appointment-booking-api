const express = require("express");

const prescriptionController = require("../controllers/prescription.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const { createPrescriptionSchema, updatePrescriptionSchema } = require("../validators/prescription.validator");

const router = express.Router();
router.use(verifyJWT);

router.post("/", authorizeRoles("doctor"), validate(createPrescriptionSchema), prescriptionController.createPrescription);
router.get("/", authorizeRoles("patient", "doctor"), prescriptionController.getPrescriptions);
router.get("/:id", authorizeRoles("patient", "doctor"), prescriptionController.getPrescriptionById);
router.patch("/:id", authorizeRoles("doctor"), validate(updatePrescriptionSchema), prescriptionController.updatePrescription);
router.delete("/:id", authorizeRoles("doctor"), prescriptionController.deletePrescription);
router.get("/:id/download", authorizeRoles("patient", "doctor"), prescriptionController.downloadPrescription);

module.exports = router;
