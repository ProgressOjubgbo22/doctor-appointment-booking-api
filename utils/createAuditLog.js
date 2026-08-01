const AuditLog = require("../models/AuditLog");

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
    console.error("Audit log creation failed:", error.message);
  }
};

module.exports = createAuditLog;
