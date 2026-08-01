const { z } = require("zod");

const updatePatientSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  phoneNumber: z.string().min(7).optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
  allergies: z.array(z.string()).optional(),
  chronicConditions: z.array(z.string()).optional(),
  height: z.number().positive().optional(),
  weight: z.number().positive().optional(),
});

const emergencyContactSchema = z.object({
  fullName: z.string().min(2),
  relationship: z.string().min(2),
  phoneNumber: z.string().min(7),
  email: z.string().email().optional(),
  address: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

const updateEmergencyContactSchema = emergencyContactSchema.partial();

const addressSchema = z.object({
  addressType: z.enum(["home", "work", "other"]).optional(),
  street: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2),
  country: z.string().min(2),
  postalCode: z.string().min(2),
  isDefault: z.boolean().optional(),
});

const updateAddressSchema = addressSchema.partial();

module.exports = { updatePatientSchema, emergencyContactSchema, updateEmergencyContactSchema, addressSchema, updateAddressSchema, };
