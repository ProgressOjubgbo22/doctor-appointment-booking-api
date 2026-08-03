const express = require("express");

const chatController = require("../controllers/chat.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");

const { sendMessageSchema } = require("../validators/chat.validator");

const router = express.Router();

router.use(verifyJWT);

router.post("/doctors/:doctorId/messages", authorizeRoles("patient"), validate(sendMessageSchema), chatController.sendMessageToDoctor);
router.post("/patients/:patientId/messages", authorizeRoles("doctor"), validate(sendMessageSchema), chatController.sendMessageToPatient);
router.get("/conversations", authorizeRoles("patient", "doctor"), chatController.getMyConversations);
router.get("/conversations/:id/messages", authorizeRoles("patient", "doctor"), chatController.getConversationMessages);

module.exports = router;
