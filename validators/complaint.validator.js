const { z } = require("zod");
const { REPORT_REASONS } = require("../models/Complaint");

const reportSchema = z.object({
  appointmentId: z.string().min(1).optional(),
  reason: z.enum(REPORT_REASONS),
  description: z.string().min(10, "Please provide a bit more detail (at least 10 characters).").max(2000),
});

const updateComplaintStatusSchema = z.object({
  status: z.enum(["pending", "under_review", "resolved", "dismissed"]).optional(),
  adminNotes: z.string().max(2000).optional(),
});

module.exports = { reportSchema, updateComplaintStatusSchema };
