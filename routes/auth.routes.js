const express = require("express");
const rateLimit = require("express-rate-limit");

const {
  register, login, logout, refreshAccessToken, forgotPassword,
  resetPassword, verifyEmail, resendVerification, changePassword, getMe,  acceptDoctorInvitation,
} = require("../controllers/auth.controller");

const validate = require("../middleware/validate.middleware");
const verifyJWT = require("../middleware/auth.middleware");
const {
  registerSchema, loginSchema, forgotPasswordSchema,
  resetPasswordSchema, changePasswordSchema, resendVerificationSchema, acceptInvitationSchema,
} = require("../validators/auth.validator");

const router = express.Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many attempts, please try again later." });

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/logout", verifyJWT, logout);
router.post("/refresh-token", refreshAccessToken);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password/:token", validate(resetPasswordSchema), resetPassword);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", authLimiter, validate(resendVerificationSchema), resendVerification);
router.post("/accept-invitation", authLimiter, validate(acceptInvitationSchema), acceptDoctorInvitation);
router.patch("/change-password", verifyJWT, validate(changePasswordSchema), changePassword);
router.get("/me", verifyJWT, getMe);

module.exports = router;
