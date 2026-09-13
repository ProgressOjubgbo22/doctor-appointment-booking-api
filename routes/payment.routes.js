const express = require("express");

const paymentController = require("../controllers/payment.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const idempotency = require("../middleware/idempotency.middleware");
const { createPaymentSchema, refundPaymentSchema } = require("../validators/payment.validator");

const router = express.Router();
router.use(verifyJWT);

// Idempotency-Key support avoids creating a second Stripe checkout session
// (or double-charging) if a client retries this call.
router.post("/", authorizeRoles("patient"), idempotency(), validate(createPaymentSchema), paymentController.createPayment);
router.get("/", authorizeRoles("patient", "doctor", "admin"), paymentController.getPayments);
router.post("/verify", authorizeRoles("patient"), paymentController.verifyPayment);
router.post("/refund", authorizeRoles("admin", "doctor"), validate(refundPaymentSchema), paymentController.refundPayment);
router.get("/invoices/:id", authorizeRoles("patient", "doctor", "admin"), paymentController.getInvoice);
router.get("/:id", authorizeRoles("patient", "doctor", "admin"), paymentController.getPaymentById);

module.exports = router;
