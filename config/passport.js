const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");

const User = require("../models/User");
const Patient = require("../models/Patient");
const logger = require("./logger");

// Only registered when Google OAuth credentials are actually configured, so
// projects that don't need OAuth yet can leave the env vars blank without
// passport throwing on startup.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) return done(new Error("Google account has no email address."));

          // 1) Already linked this Google account before.
          let user = await User.findOne({ googleId: profile.id });

          // 2) First time via Google, but an account with this email already
          //    exists (e.g. they originally registered with a password) - link it.
          if (!user) {
            user = await User.findOne({ email });
            if (user) {
              user.googleId = profile.id;
              user.isEmailVerified = true;
              if (!user.authProvider || user.authProvider === "local") user.authProvider = "google";
              await user.save();
            }
          }

          // 3) Brand new user signing up via Google.
          if (!user) {
            user = await User.create({
              firstName: profile.name?.givenName || profile.displayName || "Google",
              lastName: profile.name?.familyName || "User",
              email,
              googleId: profile.id,
              authProvider: "google",
              role: "patient",
              accountStatus: "active",
              isEmailVerified: true,
              profilePicture: profile.photos?.[0]?.value || "",
            });
            await Patient.create({ userId: user._id });
          }

          if (user.accountStatus === "suspended") {
            return done(null, false, { message: "Your account has been suspended. Please contact support." });
          }
          if (user.accountStatus === "inactive") {
            return done(null, false, { message: "Your account is inactive. Please contact support." });
          }

          return done(null, user);
        } catch (error) {
          logger.error("Google OAuth strategy error", { error: error.message });
          return done(error);
        }
      }
    )
  );
} else {
  logger.warn("Google OAuth is not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing) - /api/auth/google routes will 501 until configured.");
}

// No session-based auth is used elsewhere in this app (it's JWT/cookie
// based), so passport is only used in "stateless" mode for the OAuth
// handshake itself; serialize/deserialize are unused but kept for safety
// in case any consumer enables sessions.
passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;
