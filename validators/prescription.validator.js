const { z } = require("zod");

const createPrescriptionSchema = z.object({
  appointmentId: z.string().min(1),
  medicationName: z.string().min(2),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  duration: z.string().min(1),
  instructions: z.string().max(1000).optional(),
});

const updatePrescriptionSchema = z.object({
  medicationName: z.string().min(2).optional(),
  dosage: z.string().min(1).optional(),
  frequency: z.string().min(1).optional(),
  duration: z.string().min(1).optional(),
  instructions: z.string().max(1000).optional(),
  status: z.enum(["active", "completed", "cancelled"]).optional(),
});

module.exports = { createPrescriptionSchema, updatePrescriptionSchema };
