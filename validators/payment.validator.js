const { z } = require("zod");

const createPaymentSchema = z.object({
  appointmentId: z.string().min(1),
  paymentMethod: z.enum(["card", "bank_transfer", "mobile_wallet", "cash"]),
});

const refundPaymentSchema = z.object({
  paymentId: z.string().min(1),
  refundAmount: z.number().positive().optional(),
  refundReason: z.string().min(2).max(500),
});

module.exports = { createPaymentSchema, refundPaymentSchema };
