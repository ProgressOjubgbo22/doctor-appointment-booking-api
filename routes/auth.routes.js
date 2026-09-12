const express = require("express");
const rateLimit = require("express-rate-limit");
const passport = require("../config/passport");

const {
  register, login, logout, refreshAccessToken, forgotPassword,
  resetPassword, verifyEmail, resendVerification, changePassword, getMe,  acceptDoctorInvitation,
  setupTwoFactor, verifyTwoFactorSetup, disableTwoFactor, verifyTwoFactorLogin, googleAuthCallback,
} = require("../controllers/auth.controller");

const validate = require("../middleware/validate.middleware");
const verifyJWT = require("../middleware/auth.middleware");
const ApiError = require("../utils/ApiError");
const {
  registerSchema, loginSchema, forgotPasswordSchema,
  resetPasswordSchema, changePasswordSchema, resendVerificationSchema, acceptInvitationSchema,
   twoFactorTokenSchema, twoFactorLoginSchema, twoFactorDisableSchema,
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

// ---- Two-factor authentication (TOTP) ----
router.post("/2fa/setup", verifyJWT, setupTwoFactor);
router.post("/2fa/verify", verifyJWT, validate(twoFactorTokenSchema), verifyTwoFactorSetup);
router.post("/2fa/disable", verifyJWT, validate(twoFactorDisableSchema), disableTwoFactor);
router.post("/2fa/login", authLimiter, validate(twoFactorLoginSchema), verifyTwoFactorLogin);

// ---- Google OAuth ----
// Guarded so the routes return a clear 501 instead of a passport crash when
// GOOGLE_CLIENT_ID/SECRET haven't been configured yet (see config/passport.js).
const requireGoogleConfigured = (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return next(new ApiError(501, "Google OAuth is not configured on this server."));
  }
  next();
};

router.get("/google", requireGoogleConfigured, passport.authenticate("google", { scope: ["profile", "email"], session: false }));
router.get(
  "/google/callback",
  requireGoogleConfigured,
  passport.authenticate("google", { session: false, failureRedirect: `${process.env.CLIENT_URL || ""}/login?error=google_auth_failed` }),
  googleAuthCallback
);

module.exports = router;
