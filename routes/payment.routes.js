const express = require("express");

const paymentController = require("../controllers/payment.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const { createPaymentSchema, refundPaymentSchema } = require("../validators/payment.validator");

const router = express.Router();
router.use(verifyJWT);

router.post("/", authorizeRoles("patient"), validate(createPaymentSchema), paymentController.createPayment);
router.get("/", authorizeRoles("patient", "doctor", "admin"), paymentController.getPayments);
router.post("/verify", authorizeRoles("patient"), paymentController.verifyPayment);
router.post("/refund", authorizeRoles("admin", "doctor"), validate(refundPaymentSchema), paymentController.refundPayment);
router.get("/invoices/:id", authorizeRoles("patient", "doctor", "admin"), paymentController.getInvoice);
router.get("/:id", authorizeRoles("patient", "doctor", "admin"), paymentController.getPaymentById);

module.exports = router;
