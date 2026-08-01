const { z } = require("zod");

const updateDoctorSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  phoneNumber: z.string().min(7).optional(),
  qualification: z.array(z.string()).optional(),
  yearsOfExperience: z.number().min(0).optional(),
  bio: z.string().max(2000).optional(),
});

const consultationFeeSchema = z.object({
  consultationFee: z.number().positive("Consultation fee must be a positive number"),
});

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const availabilitySchema = z
  .object({
    dayOfWeek: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
    startTime: z.string().regex(timeRegex, "startTime must be HH:mm"),
    endTime: z.string().regex(timeRegex, "endTime must be HH:mm"),
    breakStartTime: z.string().regex(timeRegex).optional(),
    breakEndTime: z.string().regex(timeRegex).optional(),
    isAvailable: z.boolean().optional(),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: "startTime must be before endTime",
    path: ["endTime"],
  });

const unavailableDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  reason: z.string().optional(),
});

module.exports = { updateDoctorSchema, consultationFeeSchema, availabilitySchema, unavailableDateSchema };
