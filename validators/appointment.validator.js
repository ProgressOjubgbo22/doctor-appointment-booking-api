const { z } = require("zod");

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const createAppointmentSchema = z.object({
  doctorId: z.string().min(1),
  appointmentDate: z.string().regex(dateRegex, "appointmentDate must be YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex, "startTime must be HH:mm"),
  endTime: z.string().regex(timeRegex, "endTime must be HH:mm"),
  reasonForVisit: z.string().max(1000).optional(),
  paymentMethod: z.enum(["card", "bank_transfer", "mobile_wallet", "cash"]).default("cash"),
});

const rescheduleAppointmentSchema = z.object({
  appointmentDate: z.string().regex(dateRegex, "appointmentDate must be YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex, "startTime must be HH:mm"),
  endTime: z.string().regex(timeRegex, "endTime must be HH:mm"),
});

const cancelAppointmentSchema = z.object({
  cancelReason: z.string().min(2).max(500),
});

const rejectAppointmentSchema = z.object({
  cancelReason: z.string().min(2).max(500),
});

module.exports = {
  createAppointmentSchema,
  rescheduleAppointmentSchema,
  cancelAppointmentSchema,
  rejectAppointmentSchema,
};
