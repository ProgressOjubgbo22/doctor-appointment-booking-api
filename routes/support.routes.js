const express = require("express");

const supportController = require("../controllers/support.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");

const { createTicketSchema, addTicketMessageSchema } = require("../validators/support.validator");

const router = express.Router();

router.use(verifyJWT);

router.post("/tickets", authorizeRoles("patient", "doctor"), validate(createTicketSchema), supportController.createTicket);
router.get("/tickets", authorizeRoles("patient", "doctor"), supportController.getMyTickets);
router.get("/tickets/:id", authorizeRoles("patient", "doctor", "admin"), supportController.getTicketById);
router.post("/tickets/:id/messages", authorizeRoles("patient", "doctor", "admin"), validate(addTicketMessageSchema), supportController.addTicketMessage);
router.patch("/tickets/:id/close", authorizeRoles("patient", "doctor"), supportController.closeTicket);

module.exports = router;
