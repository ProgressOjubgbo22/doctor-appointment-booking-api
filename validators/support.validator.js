const { z } = require("zod");

const createTicketSchema = z.object({
  subject: z.string().min(3, "Subject must be at least 3 characters").max(200),
  category: z
    .enum(["technical", "billing", "appointment", "account", "medical_records", "other"])
    .default("other"),
  message: z.string().min(5, "Please describe your issue in a bit more detail.").max(5000),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

const addTicketMessageSchema = z.object({
  message: z.string().min(1, "Message can't be empty").max(5000),
});

const updateTicketSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assignedAdminId: z.string().optional(),
});

module.exports = { createTicketSchema, addTicketMessageSchema, updateTicketSchema };
