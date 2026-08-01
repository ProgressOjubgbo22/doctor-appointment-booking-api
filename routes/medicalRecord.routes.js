const express = require("express");

const medicalRecordController = require("../controllers/medicalRecord.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const upload = require("../middleware/upload.middleware");
const { createMedicalRecordSchema, updateMedicalRecordSchema } = require("../validators/medicalRecord.validator");

const router = express.Router();
router.use(verifyJWT);

router.post("/", authorizeRoles("doctor"), validate(createMedicalRecordSchema), medicalRecordController.createMedicalRecord);
router.get("/", authorizeRoles("patient", "doctor"), medicalRecordController.getMedicalRecords);
router.get("/:id", authorizeRoles("patient", "doctor"), medicalRecordController.getMedicalRecordById);
router.patch("/:id", authorizeRoles("doctor"), validate(updateMedicalRecordSchema), medicalRecordController.updateMedicalRecord);
router.post("/:id/reports", authorizeRoles("doctor"), upload.single("file"), medicalRecordController.addReportToRecord);

module.exports = router;
