const { StatusCodes } = require("http-status-codes");

const Payment = require("../models/Payment");
const Appointment = require("../models/Appointment");
const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createNotification = require("../utils/createNotification");
const createAuditLog = require("../utils/createAuditLog");
const stripe = require("../config/stripe");
const { streamPdfToResponse, buildInvoicePdf } = require("../utils/generatePdf");
const withTransaction = require("../utils/withTransaction");
const withRetry = require("../utils/withRetry");
const logger = require("../config/logger");

// Stripe's SDK already retries idempotent GETs internally, but checkout
// session creation is a POST - wrap it so a transient network blip doesn't
// surface as a hard failure to the patient trying to pay.
const isRetryableStripeError = (error) =>
  ["StripeConnectionError", "StripeAPIError", "StripeRateLimitError"].includes(error.type);

const populateOpts = [
  { path: "appointmentId", select: "appointmentDate startTime status" },
  { path: "doctorId", populate: { path: "userId", select: "firstName lastName" } },
  { path: "patientId", populate: { path: "userId", select: "firstName lastName" } },
];

// POST /api/payments  (patient - initiate/pay for an existing appointment's payment record)
const createPayment = asyncHandler(async (req, res) => {
  const { appointmentId, paymentMethod } = req.body;

  const patient = await Patient.findOne({ userId: req.user._id });
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found.");
  if (String(appointment.patientId) !== String(patient._id)) throw new ApiError(403, "Not your appointment.");

  let payment = await Payment.findOne({ appointmentId });
  if (!payment) throw new ApiError(404, "No payment record found for this appointment.");
  if (payment.paymentStatus === "paid") throw new ApiError(400, "This appointment has already been paid for.");

  payment.paymentMethod = paymentMethod;

  if (paymentMethod === "cash") {
    await payment.save();
     await createAuditLog({
          req,
          action: "create",
          entityName: "Payment",
          entityId: payment._id,
          description: "Patient selected cash payment for an appointment.",
        });
    return res.status(StatusCodes.OK).json(new ApiResponse(200, payment, "Cash payment will be collected at the hospital."));
  }

  // Card / online payment via Stripe Checkout (retried on transient Stripe/network errors)
  const session = await withRetry(
    () =>
      stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: "Consultation fee" },
              unit_amount: Math.round(payment.amount * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.CLIENT_URL}/payments/success?appointmentId=${appointmentId}`,
        cancel_url: `${process.env.CLIENT_URL}/payments/cancel?appointmentId=${appointmentId}`,
        metadata: { paymentId: String(payment._id), appointmentId: String(appointmentId) },
      }),
    { retries: 2, baseDelayMs: 400, shouldRetry: isRetryableStripeError, label: "Stripe checkout session creation" }
  );

  payment.paymentIntentId = session.id;
  await payment.save();

   await createAuditLog({
      req,
      action: "create",
      entityName: "Payment",
      entityId: payment._id,
      description: `Stripe checkout session created for card payment (${session.id}).`,
    });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { checkoutUrl: session.url }, "Checkout session created."));
});

// GET /api/payments
const getPayments = asyncHandler(async (req, res) => {
  let filter = {};
  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    filter.patientId = patient?._id;
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    filter.doctorId = doctor?._id;
  }

  const payments = await Payment.find(filter).populate(populateOpts).sort({ createdAt: -1 });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, payments, "Payments fetched."));
});

// GET /api/payments/:id
const getPaymentById = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id).populate(populateOpts);
  if (!payment) throw new ApiError(404, "Payment not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(payment.patientId._id) !== String(patient._id)) throw new ApiError(403, "Access denied.");
  }

  if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(payment.doctorId._id) !== String(doctor._id)) throw new ApiError(403, "Access denied.");
  }

  return res.status(StatusCodes.OK).json(new ApiResponse(200, payment, "Payment fetched."));
});

// POST /api/payments/verify
const verifyPayment = asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  const payment = await Payment.findOne({ paymentIntentId: sessionId });
  if (!payment) throw new ApiError(404, "Payment record not found.");

  if (session.payment_status === "paid" && payment.paymentStatus !== "paid") {
    payment.paymentStatus = "paid";
    payment.paidAt = new Date();
    await payment.save();

    await createNotification({
      userId: (await Patient.findById(payment.patientId)).userId,
      title: "Payment confirmed",
      message: `Your payment of $${payment.amount} has been confirmed.`,
      type: "payment_confirmation",
    });

    await createNotification({
      userId: (await Doctor.findById(payment.doctorId)).userId,
      title: "Payment received",
      message: `A payment of $${payment.amount} was received for an appointment.`,
      type: "payment_received",
    });
  }

  return res.status(StatusCodes.OK).json(new ApiResponse(200, payment, "Payment status verified."));
});

// POST /api/payments/refund  (admin/doctor)
const refundPayment = asyncHandler(async (req, res) => {
  const { paymentId, refundAmount, refundReason } = req.body;

  const payment = await Payment.findById(paymentId);
  if (!payment) throw new ApiError(404, "Payment not found.");
  if (payment.paymentStatus !== "paid") throw new ApiError(400, "Only paid payments are eligible for refund.");

  const amountToRefund = refundAmount || payment.amount;

  if (payment.paymentIntentId && payment.paymentMethod === "card") {
    try {
      const session = await stripe.checkout.sessions.retrieve(payment.paymentIntentId);
      if (session.payment_intent) {
        await withRetry(
          () =>
            stripe.refunds.create({
              payment_intent: session.payment_intent,
              amount: Math.round(amountToRefund * 100),
            }),
          { retries: 2, baseDelayMs: 400, shouldRetry: isRetryableStripeError, label: "Stripe refund creation" }
        );
      }
    } catch (err) {
      logger.error("Refund failed at payment gateway", { paymentId, error: err.message });
      throw new ApiError(500, "Refund failed at payment gateway. Please try again or contact support.");
    }
  }

  payment.paymentStatus = "refunded";
  payment.refundAmount = amountToRefund;
  payment.refundReason = refundReason;
  await payment.save();

  await createAuditLog({
    req,
    action: "refund",
    entityName: "Payment",
    entityId: payment._id,
    description: `Refund of ${amountToRefund} issued. Reason: ${refundReason}`,
  });

  const patient = await Patient.findById(payment.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Refund processed",
    message: `A refund of $${amountToRefund} has been processed for your appointment.`,
    type: "payment_confirmation",
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, payment, "Refund processed."));
});

// GET /api/payments/invoices/:id
const getInvoice = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id).populate(populateOpts);
  if (!payment) throw new ApiError(404, "Payment not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(payment.patientId._id) !== String(patient._id)) throw new ApiError(403, "Access denied.");
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(payment.doctorId._id) !== String(doctor._id)) throw new ApiError(403, "Access denied.");
  }

  const invoiceData = {
    invoiceId: payment._id,
    date: payment.paidAt || payment.createdAt,
    patient: payment.patientId?.userId,
    doctor: payment.doctorId?.userId,
    appointment: payment.appointmentId,
    amount: payment.amount,
    paymentMethod: payment.paymentMethod,
    paymentStatus: payment.paymentStatus,
  };

  streamPdfToResponse(res, {
    filename: `invoice-${payment._id}.pdf`,
    buildFn: (doc) => buildInvoicePdf(doc, invoiceData),
  });
});

// ---- Stripe webhook (called by Stripe, not by the client) ----

/**
 * Marks a payment as paid (idempotent) and, if the linked appointment is
 * still pending, auto-confirms it now that payment has cleared. Also
 * notifies the patient and writes an audit log entry.
 */
const markPaymentPaidFromWebhook = async (payment, eventType) => {
  if (payment.paymentStatus === "paid") return; // idempotent - already processed, avoid duplicate side effects
                                                // (Stripe may deliver the same webhook event more than once)

   // Payment + its appointment's status move together atomically, so a crash
  // mid-webhook can't leave a "paid" payment linked to a still-"pending" appointment.
  await withTransaction(async (session) => {
    payment.paymentStatus = "paid";
    payment.paidAt = new Date();
    await payment.save({ session });
  
    const appointment = await Appointment.findById(payment.appointmentId).session(session || null);
    if (appointment && appointment.status === "pending") {
      appointment.status = "confirmed";
      await appointment.save({ session });
    }
  });

  const patient = await Patient.findById(payment.patientId);
  if (patient) {
    await createNotification({
      userId: patient.userId,
      title: "Payment confirmed",
      message: `Your payment of $${payment.amount} has been confirmed.`,
      type: "payment_confirmation",
    });
  }

  await createAuditLog({
    req: {},
    action: "webhook_payment_succeeded",
    entityName: "Payment",
    entityId: payment._id,
    description: `Stripe webhook (${eventType}) marked payment as paid.`,
  });
};

const markPaymentFailedFromWebhook = async (payment, eventType) => {
  if (payment.paymentStatus === "paid") return; // never downgrade an already-paid record

  payment.paymentStatus = "failed";
  await payment.save();

  const patient = await Patient.findById(payment.patientId);
  if (patient) {
    await createNotification({
      userId: patient.userId,
      title: "Payment failed",
      message: `Your payment attempt of $${payment.amount} did not go through. Please try again.`,
      type: "payment_confirmation",
    });
  }

  await createAuditLog({
    req: {},
    action: "webhook_payment_failed",
    entityName: "Payment",
    entityId: payment._id,
    description: `Stripe webhook (${eventType}) marked payment as failed.`,
  });
};

const findPaymentForSession = async (session) => {
  if (session.metadata?.paymentId) {
    const byId = await Payment.findById(session.metadata.paymentId);
    if (byId) return byId;
  }
  return Payment.findOne({ paymentIntentId: session.id });
};

/**
 * POST /api/payments/webhook
 *
 * IMPORTANT: this route must receive the *raw* request body (not JSON-parsed)
 * so Stripe's signature can be verified. It is mounted in app.js with
 * express.raw({ type: "application/json" }) BEFORE the global express.json()
 * middleware, and points directly at this handler (not through the normal
 * validated /api/payments router).
 *
 * We build Stripe Checkout Sessions (see createPayment above), so the
 * events we care about are the checkout.session.* family rather than a bare
 * payment_intent.succeeded - Checkout already wraps the PaymentIntent for us.
 */
const handleStripeWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error("Stripe webhook signature verification failed", { error: err.message });
    return res.status(StatusCodes.BAD_REQUEST).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      const payment = await findPaymentForSession(session);
      if (payment && session.payment_status === "paid") {
        await markPaymentPaidFromWebhook(payment, event.type);
      }
      break;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      const payment = await findPaymentForSession(session);
      if (payment) await markPaymentFailedFromWebhook(payment, event.type);
      break;
    }

    case "checkout.session.expired": {
      const session = event.data.object;
      const payment = await findPaymentForSession(session);
      if (payment && payment.paymentStatus === "pending") {
        payment.paymentStatus = "cancelled";
        await payment.save();
      }
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object;
      const payment = await Payment.findOne({ paymentIntentId: charge.payment_intent });
      if (payment && payment.paymentStatus !== "refunded") {
        payment.paymentStatus = "refunded";
        payment.refundAmount = charge.amount_refunded / 100;
        payment.refundReason = payment.refundReason || "Refund processed via Stripe.";
        await payment.save();

        const patient = await Patient.findById(payment.patientId);
        if (patient) {
          await createNotification({
            userId: patient.userId,
            title: "Refund processed",
            message: `A refund of $${payment.refundAmount} has been processed for your appointment.`,
            type: "payment_confirmation",
          });
        }

        await createAuditLog({
          req: {},
          action: "webhook_refund",
          entityName: "Payment",
          entityId: payment._id,
          description: `Stripe webhook (${event.type}) recorded a refund of ${payment.refundAmount}.`,
        });
      }
      break;
    }

    default:
      // Unhandled event types are acknowledged but otherwise ignored.
      break;
  }

  // Stripe expects a fast 2xx acknowledgement regardless of what we did above.
  return res.status(StatusCodes.OK).json({ received: true });
});

module.exports = {
  createPayment,
  getPayments,
  getPaymentById,
  verifyPayment,
  refundPayment,
  getInvoice,
  handleStripeWebhook,
};
