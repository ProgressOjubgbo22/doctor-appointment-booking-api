const nodemailer = require("nodemailer");
const logger = require("../config/logger");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async ({ to, subject, html }) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });
  } catch (error) {
    // This function is invoked from workers/email.worker.js (the only
    // remaining caller - everything else now goes through
    // utils/queueEmail.js -> the "email-queue" BullMQ queue). Rethrowing
    // here is what lets BullMQ's retry/backoff (see queues/queue.js) kick
    // in on a transient SMTP failure instead of silently dropping the email.
    logger.error("Email sending failed", { to, subject, error: error.message });
    throw error;
  }
};

module.exports = sendEmail;
