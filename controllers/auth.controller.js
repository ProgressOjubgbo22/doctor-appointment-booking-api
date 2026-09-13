const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const dayjs = require("dayjs");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const { StatusCodes } = require("http-status-codes");

const User = require("../models/User");
const Patient = require("../models/Patient");
const RefreshToken = require("../models/RefreshToken");
const VerificationToken = require("../models/VerificationToken");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const sendEmail = require("../utils/queueEmail");
const createAuditLog = require("../utils/createAuditLog");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateTokens");

// Short-lived token proving "this request already supplied a correct
// password for this user" - issued by login() when 2FA is enabled, and
// required by verifyTwoFactorLogin() below to complete the sign-in. Kept
// separate from the access/refresh secrets so a leaked challenge token
// can't be replayed as a real session token (and vice versa).
const TWO_FACTOR_CHALLENGE_SECRET = process.env.JWT_2FA_SECRET || process.env.JWT_ACCESS_SECRET;
const TWO_FACTOR_CHALLENGE_EXPIRES_IN = "5m";

const issueTwoFactorChallenge = (user) =>
  jwt.sign({ userId: user._id, purpose: "2fa_challenge" }, TWO_FACTOR_CHALLENGE_SECRET, {
    expiresIn: TWO_FACTOR_CHALLENGE_EXPIRES_IN,
  });

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
};

const issueTokens = async (user, res) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await RefreshToken.create({
    userId: user._id,
    token: refreshToken,
    expiresAt: dayjs().add(7, "day").toDate(),
  });

  res.cookie("accessToken", accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie("refreshToken", refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

  return { accessToken, refreshToken };
};

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phoneNumber } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) throw new ApiError(409, "An account with this email already exists.");

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    phoneNumber,
    role: "patient",
    accountStatus: "active",
  });

  await Patient.create({ userId: user._id });

  const verificationToken = crypto.randomBytes(32).toString("hex");
  await VerificationToken.create({
    userId: user._id,
    token: verificationToken,
    type: "email_verification",
    expiresAt: dayjs().add(24, "hour").toDate(),
  });

  const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;
  await sendEmail({
    to: user.email,
    subject: "Verify your email - City Care Hospital",
    html: `<p>Hi ${user.firstName},</p><p>Please verify your email by clicking the link below:</p><a href="${verifyUrl}">${verifyUrl}</a><p>This link expires in 24 hours.</p>`,
  });

  return res
    .status(StatusCodes.CREATED)
    .json(new ApiResponse(201, { userId: user._id, email: user.email }, "Registration successful. Please check your email to verify your account."));
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select("+password");
  if (!user) {
     await createAuditLog({ req, action: "login_failed", entityName: "User", description: `Login attempt for unknown email: ${email}` });
     throw new ApiError(401, "Invalid email or password.");
   }

  if (user.authProvider === "google" && !user.password) {
    throw new ApiError(400, "This account signs in with Google. Please use \"Sign in with Google\" instead.");
  }

  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
     await createAuditLog({
       req: { user, ip: req.ip, headers: req.headers },
       action: "login_failed",
       entityName: "User",
       entityId: user._id,
       description: "Incorrect password.",
     });
     throw new ApiError(401, "Invalid email or password.");
   }

  if (user.accountStatus === "suspended") {
    throw new ApiError(403, "Your account has been suspended. Please contact support.");
  }
  if (user.accountStatus === "inactive") {
    throw new ApiError(403, "Your account is inactive. Please contact support.");
  }
  if (!user.isEmailVerified && user.role !== "admin") {
    throw new ApiError(403, "Please verify your email before logging in.");
  }

  // Password was correct, but if 2FA is enabled we stop short of issuing
  // real session tokens - the client must call POST /api/auth/2fa/login
  // with a valid TOTP code and this challenge token to finish logging in.
  if (user.twoFactorEnabled) {
    const challengeToken = issueTwoFactorChallenge(user);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(200, { twoFactorRequired: true, challengeToken }, "Enter your two-factor authentication code to continue."));
  }

  user.lastLogin = new Date();
  await user.save();

  const { accessToken, refreshToken } = await issueTokens(user, res);

  await createAuditLog({
      req: { user, ip: req.ip, headers: req.headers },
      action: "login",
      entityName: "User",
      entityId: user._id,
      description: `${user.role} logged in successfully.`,
    });

  const userSafe = user.toObject();
  delete userSafe.password;

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { user: userSafe, accessToken, refreshToken }, "Login successful."));
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) {
    await RefreshToken.deleteOne({ token: refreshToken });
  }
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);

  await createAuditLog({ req, action: "logout", entityName: "User", entityId: req.user?._id, description: "User logged out." });
  
  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Logged out successfully."));
});

// POST /api/auth/refresh-token
const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingToken = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!incomingToken) throw new ApiError(401, "Refresh token missing.");

  let decoded;
  try {
    decoded = jwt.verify(incomingToken, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    throw new ApiError(401, "Invalid or expired refresh token.");
  }

  const storedToken = await RefreshToken.findOne({ token: incomingToken, userId: decoded.userId });
  if (!storedToken) throw new ApiError(401, "Refresh token not recognized. Please log in again.");

  const user = await User.findById(decoded.userId);
  if (!user) throw new ApiError(401, "User no longer exists.");

  // Rotate refresh token
  await RefreshToken.deleteOne({ _id: storedToken._id });
  const { accessToken, refreshToken } = await issueTokens(user, res);

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { accessToken, refreshToken }, "Token refreshed."));
});

// POST /api/auth/forgot-password
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  // Always return success to avoid leaking which emails are registered
  if (!user) {
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(200, null, "If that email is registered, a reset link has been sent."));
  }

  await VerificationToken.deleteMany({ userId: user._id, type: "password_reset" });

  const resetToken = crypto.randomBytes(32).toString("hex");
  await VerificationToken.create({
    userId: user._id,
    token: resetToken,
    type: "password_reset",
    expiresAt: dayjs().add(1, "hour").toDate(),
  });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
  await sendEmail({
    to: user.email,
    subject: "Password Reset - City Care Hospital",
    html: `<p>Hi ${user.firstName},</p><p>Click below to reset your password. This link expires in 1 hour.</p><a href="${resetUrl}">${resetUrl}</a>`,
  });

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, null, "If that email is registered, a reset link has been sent."));
});

// POST /api/auth/reset-password/:token
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  const verificationToken = await VerificationToken.findOne({ token, type: "password_reset" });
  if (!verificationToken) throw new ApiError(400, "Invalid or expired reset token.");

  if (dayjs().isAfter(verificationToken.expiresAt)) {
    await verificationToken.deleteOne();
    throw new ApiError(400, "Reset token has expired. Please request a new one.");
  }

  const user = await User.findById(verificationToken.userId);
  if (!user) throw new ApiError(404, "User not found.");

  user.password = password;
  await user.save();

  await verificationToken.deleteOne();
  await RefreshToken.deleteMany({ userId: user._id }); // invalidate old sessions

   await createAuditLog({
      req: { user, ip: req.ip, headers: req.headers },
      action: "password_reset",
      entityName: "User",
      entityId: user._id,
      description: "Password reset via forgot-password flow. All sessions invalidated.",
    });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Password reset successful. Please log in."));
});

// POST /api/auth/verify-email
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;

  const verificationToken = await VerificationToken.findOne({ token, type: "email_verification" });
  if (!verificationToken) throw new ApiError(400, "Invalid or expired verification token.");

  if (dayjs().isAfter(verificationToken.expiresAt)) {
    await verificationToken.deleteOne();
    throw new ApiError(400, "Verification token has expired. Please request a new one.");
  }

  await User.findByIdAndUpdate(verificationToken.userId, { isEmailVerified: true });
  await verificationToken.deleteOne();

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Email verified successfully."));
});

// POST /api/auth/resend-verification
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(200, null, "If that email is registered and unverified, a new link has been sent."));
  }
  if (user.isEmailVerified) {
    return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Email is already verified."));
  }

  await VerificationToken.deleteMany({ userId: user._id, type: "email_verification" });

  const verificationToken = crypto.randomBytes(32).toString("hex");
  await VerificationToken.create({
    userId: user._id,
    token: verificationToken,
    type: "email_verification",
    expiresAt: dayjs().add(24, "hour").toDate(),
  });

  const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;
  await sendEmail({
    to: user.email,
    subject: "Verify your email - City Care Hospital",
    html: `<p>Hi ${user.firstName},</p><p>Please verify your email:</p><a href="${verifyUrl}">${verifyUrl}</a>`,
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Verification email sent."));
});

// POST /api/auth/accept-invitation
// Consumes the "doctor_setup" token an admin's invite email points to
// (see admin.controller.js createDoctor). Lets the invited doctor set
// their own password in place of the random temp password, then logs
// them straight in.
const acceptDoctorInvitation = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const verificationToken = await VerificationToken.findOne({ token, type: "doctor_setup" });
  if (!verificationToken) throw new ApiError(400, "Invalid or already-used invitation link.");

  if (dayjs().isAfter(verificationToken.expiresAt)) {
    await verificationToken.deleteOne();
    throw new ApiError(400, "This invitation link has expired. Please ask an administrator to resend it.");
  }

  const user = await User.findById(verificationToken.userId);
  if (!user) {
    await verificationToken.deleteOne();
    throw new ApiError(404, "The invited account no longer exists.");
  }
  if (user.role !== "doctor") {
    throw new ApiError(400, "This invitation link is not valid for this account.");
  }

  user.password = password;
  user.isEmailVerified = true;
  if (user.accountStatus === "pending") user.accountStatus = "active";
  await user.save();

  await verificationToken.deleteOne();

  const { accessToken, refreshToken } = await issueTokens(user, res);

  await createAuditLog({
    req: { user, ip: req.ip, headers: req.headers },
    action: "accept_invitation",
    entityName: "User",
    entityId: user._id,
    description: "Doctor accepted their admin invitation and set their own password.",
  });

  const userSafe = user.toObject();
  delete userSafe.password;

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { user: userSafe, accessToken, refreshToken }, "Account activated. You are now logged in."));
});

// PATCH /api/auth/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select("+password");
  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) throw new ApiError(401, "Current password is incorrect.");

  user.password = newPassword;
  await user.save();

  await RefreshToken.deleteMany({ userId: user._id }); // invalidate other sessions

    await createAuditLog({
      req,
      action: "password_change",
      entityName: "User",
      entityId: user._id,
      description: "User changed their own password. All sessions invalidated.",
    });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Password changed successfully. Please log in again."));
});

// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  return res.status(StatusCodes.OK).json(new ApiResponse(200, req.user, "Current user fetched."));
});

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP via speakeasy + qrcode)
// ---------------------------------------------------------------------------

// POST /api/auth/2fa/setup  (authenticated)
// Generates a new TOTP secret and returns it as a scannable QR code. The
// secret is stashed as "pending" (twoFactorTempSecret) - it only becomes
// the account's real secret once the user proves they scanned it correctly
// via POST /api/auth/2fa/verify, so a setup request that's abandoned
// halfway through can never silently enable 2FA with a secret the user
// never actually saved in their authenticator app.
const setupTwoFactor = asyncHandler(async (req, res) => {
  if (req.user.twoFactorEnabled) {
    throw new ApiError(400, "Two-factor authentication is already enabled on this account.");
  }

  const secret = speakeasy.generateSecret({
    name: `City Care Hospital (${req.user.email})`,
  });

  await User.findByIdAndUpdate(req.user._id, { twoFactorTempSecret: secret.base32 });

  const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url);

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      { secret: secret.base32, qrCode: qrCodeDataUrl },
      "Scan this QR code with your authenticator app, then confirm with a code to enable 2FA."
    )
  );
});

// POST /api/auth/2fa/verify  (authenticated) - body: { token }
// Confirms the pending secret from setupTwoFactor() by checking a code
// generated from it, then promotes it to the account's active secret.
const verifyTwoFactorSetup = asyncHandler(async (req, res) => {
  const { token } = req.body;

  const user = await User.findById(req.user._id).select("+twoFactorTempSecret");
  if (!user.twoFactorTempSecret) {
    throw new ApiError(400, "No pending 2FA setup found. Call /2fa/setup first.");
  }

  const isValid = speakeasy.totp.verify({
    secret: user.twoFactorTempSecret,
    encoding: "base32",
    token,
    window: 1, // allow one 30s step of clock drift
  });
  if (!isValid) throw new ApiError(400, "Invalid authentication code. Please try again.");

  user.twoFactorSecret = user.twoFactorTempSecret;
  user.twoFactorTempSecret = undefined;
  user.twoFactorEnabled = true;
  await user.save();

  await createAuditLog({ req, action: "enable_2fa", entityName: "User", entityId: user._id, description: "User enabled two-factor authentication." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Two-factor authentication enabled."));
});

// POST /api/auth/2fa/disable  (authenticated) - body: { password }
// Requires the account password again as a safeguard against a hijacked,
// already-logged-in session silently turning 2FA off.
const disableTwoFactor = asyncHandler(async (req, res) => {
  const { password } = req.body;

  const user = await User.findById(req.user._id).select("+password");
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) throw new ApiError(401, "Incorrect password.");

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.twoFactorTempSecret = undefined;
  await user.save();

  await createAuditLog({ req, action: "disable_2fa", entityName: "User", entityId: user._id, description: "User disabled two-factor authentication." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Two-factor authentication disabled."));
});

// POST /api/auth/2fa/login  (public) - body: { challengeToken, token }
// Completes the login flow started in login() above once 2FA was required:
// validates the short-lived challenge token plus a live TOTP code, then
// issues the normal access/refresh tokens exactly like a non-2FA login.
const verifyTwoFactorLogin = asyncHandler(async (req, res) => {
  const { challengeToken, token } = req.body;
  if (!challengeToken || !token) throw new ApiError(400, "challengeToken and token are required.");

  let decoded;
  try {
    decoded = jwt.verify(challengeToken, TWO_FACTOR_CHALLENGE_SECRET);
  } catch (error) {
    throw new ApiError(401, "Invalid or expired two-factor challenge. Please log in again.");
  }
  if (decoded.purpose !== "2fa_challenge") throw new ApiError(401, "Invalid challenge token.");

  const user = await User.findById(decoded.userId).select("+twoFactorSecret");
  if (!user || !user.twoFactorEnabled) throw new ApiError(401, "Two-factor authentication is not enabled for this account.");

  const isValid = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: "base32",
    token,
    window: 1,
  });
  if (!isValid) {
    await createAuditLog({
      req: { user, ip: req.ip, headers: req.headers },
      action: "login_failed",
      entityName: "User",
      entityId: user._id,
      description: "Incorrect two-factor authentication code.",
    });
    throw new ApiError(401, "Invalid authentication code.");
  }

  user.lastLogin = new Date();
  await user.save();

  const { accessToken, refreshToken } = await issueTokens(user, res);

  await createAuditLog({
    req: { user, ip: req.ip, headers: req.headers },
    action: "login",
    entityName: "User",
    entityId: user._id,
    description: `${user.role} logged in successfully (2FA).`,
  });

  const userSafe = user.toObject();
  delete userSafe.password;
  delete userSafe.twoFactorSecret;

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { user: userSafe, accessToken, refreshToken }, "Login successful."));
});

// ---------------------------------------------------------------------------
// Google OAuth (passport-google-oauth20)
// ---------------------------------------------------------------------------

// GET /api/auth/google/callback
// Runs *after* passport's GoogleStrategy (config/passport.js) has already
// found-or-created the User and attached it to req.user. From here we just
// reuse the exact same issueTokens() helper every other login path uses, so
// the resulting session is indistinguishable from a normal login.
const googleAuthCallback = asyncHandler(async (req, res) => {
  const user = req.user; // set by passport.authenticate("google", { session: false })
  if (!user) throw new ApiError(401, "Google authentication failed.");

  user.lastLogin = new Date();
  await user.save();

  const { accessToken, refreshToken } = await issueTokens(user, res);

  await createAuditLog({
    req: { user, ip: req.ip, headers: req.headers },
    action: "login",
    entityName: "User",
    entityId: user._id,
    description: "User logged in via Google OAuth.",
  });

  // Hand off to the SPA with tokens in the query string (also already set as
  // httpOnly cookies above via issueTokens/res.cookie) so the frontend can
  // finish the redirect flow without needing a page that reads cookies.
  const redirectUrl = `${process.env.CLIENT_URL}/oauth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`;
  return res.redirect(redirectUrl);
});

module.exports = {
  register,
  login,
  logout,
  refreshAccessToken,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  acceptDoctorInvitation,
  changePassword,
  getMe,
  setupTwoFactor,
  verifyTwoFactorSetup,
  disableTwoFactor,
  verifyTwoFactorLogin,
  googleAuthCallback,
};
