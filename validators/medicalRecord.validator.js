const { z } = require("zod");

const createMedicalRecordSchema = z.object({
  appointmentId: z.string().min(1),
  diagnosis: z.string().min(1),
  symptoms: z.array(z.string()).optional(),
  treatmentPlan: z.string().optional(),
  notes: z.string().optional(),
  followUpDate: z.coerce.date().optional(),
});

const updateMedicalRecordSchema = z.object({
  diagnosis: z.string().optional(),
  symptoms: z.array(z.string()).optional(),
  treatmentPlan: z.string().optional(),
  notes: z.string().optional(),
  followUpDate: z.coerce.date().optional(),
});

module.exports = { createMedicalRecordSchema, updateMedicalRecordSchema };
