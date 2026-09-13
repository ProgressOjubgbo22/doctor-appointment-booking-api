const AuditLog = require("../models/AuditLog");
const logger = require("../config/logger");

const createAuditLog = async ({ req, action, entityName, entityId, description }) => {
  try {
    await AuditLog.create({
      userId: req.user?._id,
      action,
      entityName,
      entityId,
      description,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  } catch (error) {
    logger.error("Audit log creation failed", { error: error.message });
  }
};

module.exports = createAuditLog;
