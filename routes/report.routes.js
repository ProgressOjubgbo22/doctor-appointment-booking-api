const express = require("express");

const reportController = require("../controllers/report.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

const router = express.Router();
router.use(verifyJWT, authorizeRoles("admin"));

router.get("/revenue", reportController.getRevenueReport);
router.get("/appointments", reportController.getAppointmentsReport);
router.get("/doctors", reportController.getDoctorsReport);
router.get("/patients", reportController.getPatientsReport);

module.exports = router;
