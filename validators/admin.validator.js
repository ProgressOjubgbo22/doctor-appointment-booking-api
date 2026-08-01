const { z } = require("zod");

const createDoctorSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  phoneNumber: z.string().min(7).optional(),
  specialtyId: z.string().min(1),
  licenseNumber: z.string().min(2),
  qualification: z.array(z.string()).optional(),
  yearsOfExperience: z.number().min(0).optional(),
  consultationFee: z.number().positive(),
  bio: z.string().optional(),
});

const suspendSchema = z.object({
  reason: z.string().min(2).max(500),
});

const specialtySchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
});

const announcementSchema = z.object({
  title: z.string().min(2),
  message: z.string().min(2),
  targetRole: z.enum(["patient", "doctor", "all"]).default("all"),
});

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const adminCreateAppointmentSchema = z.object({
  patientId: z.string().min(1),
  doctorId: z.string().min(1),
  appointmentDate: z.string().regex(dateRegex, "appointmentDate must be YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex, "startTime must be HH:mm"),
  endTime: z.string().regex(timeRegex, "endTime must be HH:mm"),
  reasonForVisit: z.string().max(1000).optional(),
});

const reassignAppointmentSchema = z.object({
  doctorId: z.string().min(1),
});

module.exports = {
  createDoctorSchema,
  suspendSchema,
  specialtySchema,
  announcementSchema,
  adminCreateAppointmentSchema,
  reassignAppointmentSchema,
};
