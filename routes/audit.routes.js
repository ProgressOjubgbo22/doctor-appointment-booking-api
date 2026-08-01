const express = require("express");

const { getAuditLogs } = require("../controllers/admin.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");

const router = express.Router();
router.get("/", verifyJWT, authorizeRoles("admin"), getAuditLogs);

module.exports = router;
