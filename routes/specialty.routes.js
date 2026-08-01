const express = require("express");

const specialtyController = require("../controllers/specialty.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const { specialtySchema } = require("../validators/admin.validator");

const router = express.Router();

router.get("/", specialtyController.getSpecialties); // public
router.get("/:id/doctors", specialtyController.getDoctorsBySpecialty); // public
router.post("/", verifyJWT, authorizeRoles("admin"), validate(specialtySchema), specialtyController.createSpecialty);
router.patch("/:id", verifyJWT, authorizeRoles("admin"), specialtyController.updateSpecialty);
router.delete("/:id", verifyJWT, authorizeRoles("admin"), specialtyController.deleteSpecialty);

module.exports = router;
