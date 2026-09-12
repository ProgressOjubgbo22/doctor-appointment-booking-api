const { z } = require("zod");

const registerSchema = z.object({
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phoneNumber: z.string().min(7).max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

const acceptInvitationSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const twoFactorTokenSchema = z.object({
  token: z.string().length(6, "Authentication code must be 6 digits"),
});

const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1, "challengeToken is required"),
  token: z.string().length(6, "Authentication code must be 6 digits"),
});

const twoFactorDisableSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  resendVerificationSchema,
  acceptInvitationSchema,
  twoFactorTokenSchema,
  twoFactorLoginSchema,
  twoFactorDisableSchema,
};
