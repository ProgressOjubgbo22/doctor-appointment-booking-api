const { StatusCodes } = require("http-status-codes");
const dayjs = require("dayjs");

const Appointment = require("../models/Appointment");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Availability = require("../models/Availability");
const UnavailableDate = require("../models/UnavailableDate");
const Payment = require("../models/Payment");
const MedicalRecord = require("../models/MedicalRecord");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createNotification = require("../utils/createNotification");
const createAuditLog = require("../utils/createAuditLog");

const appointmentPopulateOptions = [
  { path: "doctorId", populate: [{ path: "userId", select: "firstName lastName profilePicture" }, { path: "specialtyId", select: "name" }] },
  { path: "patientId", populate: { path: "userId", select: "firstName lastName profilePicture phoneNumber" } },
];

const assertSlotIsBookable = async ({ doctorId, appointmentDate, startTime, endTime, excludeAppointmentId }) => {
  const dayOfWeek = dayjs(appointmentDate).format("dddd").toLowerCase();

  const blocked = await UnavailableDate.findOne({ doctorId, date: appointmentDate });
  if (blocked) throw new ApiError(400, "Doctor is not available on the selected date.");

  const availability = await Availability.findOne({ doctorId, dayOfWeek, isAvailable: true });
  if (!availability) throw new ApiError(400, "Doctor does not work on the selected day.");

  if (startTime < availability.startTime || endTime > availability.endTime) {
    throw new ApiError(400, "Selected time is outside the doctor's working hours.");
  }
  if (
    availability.breakStartTime &&
    availability.breakEndTime &&
    startTime < availability.breakEndTime &&
    endTime > availability.breakStartTime
  ) {
    throw new ApiError(400, "Selected time overlaps with the doctor's break.");
  }

  const conflictFilter = {
    doctorId,
    appointmentDate,
    startTime,
    status: { $in: ["pending", "confirmed", "checked_in", "in_progress"] },
  };
  if (excludeAppointmentId) conflictFilter._id = { $ne: excludeAppointmentId };

  const conflict = await Appointment.findOne(conflictFilter);
  if (conflict) throw new ApiError(409, "This time slot has just been booked. Please choose another.");
};

// POST /api/appointments
const createAppointment = asyncHandler(async (req, res) => {
  const { doctorId, appointmentDate, startTime, endTime, reasonForVisit, paymentMethod } = req.body;

  const patient = await Patient.findOne({ userId: req.user._id });
  if (!patient) throw new ApiError(404, "Patient profile not found.");

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found.");
  if (doctor.verificationStatus !== "verified") throw new ApiError(400, "This doctor is not currently accepting appointments.");

  if (patient.blockedDoctors.some((id) => String(id) === String(doctor._id))) {
      throw new ApiError(403, "You have blocked this doctor and can't book with them. Unblock them first if you'd like to book again.");
  }

  if (dayjs(appointmentDate).isBefore(dayjs().startOf("day"))) {
    throw new ApiError(400, "Cannot book an appointment in the past.");
  }

  await assertSlotIsBookable({ doctorId, appointmentDate, startTime, endTime });

  const appointment = await Appointment.create({
    patientId: patient._id,
    doctorId,
    appointmentDate,
    startTime,
    endTime,
    reasonForVisit,
    status: "pending",
    createdBy: "patient",
  });

  const payment = await Payment.create({
    appointmentId: appointment._id,
    patientId: patient._id,
    doctorId,
    amount: doctor.consultationFee,
    paymentMethod: paymentMethod || "cash",
    paymentStatus: paymentMethod === "cash" ? "pending" : "pending",
  });

  await createNotification({
    userId: doctor.userId,
    title: "New appointment request",
    message: `You have a new appointment request for ${appointmentDate} at ${startTime}.`,
    type: "new_appointment",
  });
  await createNotification({
    userId: req.user._id,
    title: "Appointment booked",
    message: `Your appointment with Dr. is scheduled for ${appointmentDate} at ${startTime}. It is pending confirmation.`,
    type: "appointment_confirmation",
  });

  const populated = await Appointment.findById(appointment._id).populate(appointmentPopulateOptions);

  return res
    .status(StatusCodes.CREATED)
    .json(new ApiResponse(201, { appointment: populated, payment }, "Appointment booked successfully."));
});

// GET /api/appointments
const getAppointments = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  let filter = {};

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    filter.patientId = patient?._id;
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    filter.doctorId = doctor?._id;
  }
  if (status) filter.status = status;

  const appointments = await Appointment.find(filter)
    .populate(appointmentPopulateOptions)
    .sort({ appointmentDate: -1, startTime: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Appointment.countDocuments(filter);

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { appointments, total, page: Number(page), pages: Math.ceil(total / limit) }, "Appointments fetched."));
});

// GET /api/appointments/:id
const getAppointmentById = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id).populate(appointmentPopulateOptions);
  if (!appointment) throw new ApiError(404, "Appointment not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(appointment.patientId._id) !== String(patient._id)) throw new ApiError(403, "Not your appointment.");
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(appointment.doctorId._id) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  }

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment fetched."));
});

// PATCH /api/appointments/:id/reschedule
const rescheduleAppointment = asyncHandler(async (req, res) => {
  const { appointmentDate, startTime, endTime } = req.body;
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");

  let ownerUserId;
  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(appointment.patientId) !== String(patient._id)) throw new ApiError(403, "Not your appointment.");
    const doctor = await Doctor.findById(appointment.doctorId);
    ownerUserId = doctor.userId;
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
    const patient = await Patient.findById(appointment.patientId);
    ownerUserId = patient.userId;
  }

  if (!["pending", "confirmed"].includes(appointment.status)) {
    throw new ApiError(400, `Cannot reschedule an appointment with status "${appointment.status}".`);
  }

  await assertSlotIsBookable({
    doctorId: appointment.doctorId,
    appointmentDate,
    startTime,
    endTime,
    excludeAppointmentId: appointment._id,
  });

  appointment.appointmentDate = appointmentDate;
  appointment.startTime = startTime;
  appointment.endTime = endTime;
  appointment.status = "rescheduled";
  await appointment.save();

  await createAuditLog({
      req,
      action: "reschedule",
      entityName: "Appointment",
      entityId: appointment._id,
      description: `${req.user.role} rescheduled an appointment to ${appointmentDate} ${startTime}.`,
    });

  await createNotification({
    userId: ownerUserId,
    title: "Appointment rescheduled",
    message: `An appointment has been rescheduled to ${appointmentDate} at ${startTime}.`,
    type: "reschedule_request",
  });

  const populated = await Appointment.findById(appointment._id).populate(appointmentPopulateOptions);
  return res.status(StatusCodes.OK).json(new ApiResponse(200, populated, "Appointment rescheduled."));
});

// PATCH /api/appointments/:id/cancel
const cancelAppointment = asyncHandler(async (req, res) => {
  const { cancelReason } = req.body;
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");

  let ownerUserId;
  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(appointment.patientId) !== String(patient._id)) throw new ApiError(403, "Not your appointment.");
    const doctor = await Doctor.findById(appointment.doctorId);
    ownerUserId = doctor.userId;
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
    const patient = await Patient.findById(appointment.patientId);
    ownerUserId = patient.userId;
  }

  if (["completed", "cancelled", "no_show"].includes(appointment.status)) {
    throw new ApiError(400, `Cannot cancel an appointment with status "${appointment.status}".`);
  }

  appointment.status = "cancelled";
  appointment.cancelReason = cancelReason;
  await appointment.save();

  const payment = await Payment.findOne({ appointmentId: appointment._id });
  if (payment && payment.paymentStatus === "paid") {
    payment.paymentStatus = "refunded";
    payment.refundAmount = payment.amount;
    payment.refundReason = "Appointment cancelled";
    await payment.save();
  } else if (payment) {
    payment.paymentStatus = "cancelled";
    await payment.save();
  }

    await createAuditLog({
      req,
      action: "cancel",
      entityName: "Appointment",
      entityId: appointment._id,
      description: `${req.user.role} cancelled an appointment. Reason: ${cancelReason}`,
    });

  await createNotification({
    userId: ownerUserId,
    title: "Appointment cancelled",
    message: `An appointment on ${appointment.appointmentDate} at ${appointment.startTime} has been cancelled. Reason: ${cancelReason}`,
    type: "appointment_cancellation",
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment cancelled."));
});

// PATCH /api/appointments/:id/accept  (doctor)
const acceptAppointment = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");
  if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  if (appointment.status !== "pending") throw new ApiError(400, "Only pending appointments can be accepted.");

  appointment.status = "confirmed";
  await appointment.save();

  await createAuditLog({
      req,
      action: "accept",
      entityName: "Appointment",
      entityId: appointment._id,
      description: "Doctor accepted a pending appointment request.",
    });

  const patient = await Patient.findById(appointment.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Appointment confirmed",
    message: `Your appointment on ${appointment.appointmentDate} at ${appointment.startTime} has been confirmed.`,
    type: "appointment_confirmation",
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment accepted."));
});

// PATCH /api/appointments/:id/reject  (doctor)
const rejectAppointment = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");
  if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  if (appointment.status !== "pending") throw new ApiError(400, "Only pending appointments can be rejected.");

  appointment.status = "cancelled";
  appointment.cancelReason = req.body.cancelReason;
  await appointment.save();

  const payment = await Payment.findOne({ appointmentId: appointment._id });
  if (payment && payment.paymentStatus === "pending") {
    payment.paymentStatus = "cancelled";
    await payment.save();
  }

  await createAuditLog({
      req,
      action: "reject",
      entityName: "Appointment",
      entityId: appointment._id,
      description: `Doctor rejected an appointment request. Reason: ${req.body.cancelReason}`,
    });

  const patient = await Patient.findById(appointment.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Appointment rejected",
    message: `Your appointment request for ${appointment.appointmentDate} was declined. Reason: ${req.body.cancelReason}`,
    type: "appointment_cancellation",
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment rejected."));
});

// PATCH /api/appointments/:id/check-in  (doctor/admin)
const checkInAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");

  if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  }
  if (appointment.status !== "confirmed") throw new ApiError(400, "Only confirmed appointments can be checked in.");

  appointment.status = "checked_in";
  appointment.checkedInAt = new Date();
  await appointment.save();

  await createAuditLog({
      req,
      action: "check_in",
      entityName: "Appointment",
      entityId: appointment._id,
      description: `${req.user.role} checked in a patient for their appointment.`,
    });

  const patient = await Patient.findById(appointment.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Checked in",
    message: `You have been checked in for your appointment.`,
    type: "appointment_confirmation",
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Patient checked in."));
});

// PATCH /api/appointments/:id/complete  (doctor)
const completeAppointment = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");
  if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  if (!["checked_in", "in_progress", "confirmed"].includes(appointment.status)) {
    throw new ApiError(400, `Cannot complete an appointment with status "${appointment.status}".`);
  }

  appointment.status = "completed";
  appointment.completedAt = new Date();
  await appointment.save();

  const payment = await Payment.findOne({ appointmentId: appointment._id });
  if (payment && payment.paymentMethod === "cash" && payment.paymentStatus === "pending") {
    payment.paymentStatus = "paid";
    payment.paidAt = new Date();
    await payment.save();
  }

  await createAuditLog({
      req,
      action: "complete",
      entityName: "Appointment",
      entityId: appointment._id,
      description: "Doctor marked an appointment as completed.",
    });

  const patient = await Patient.findById(appointment.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Appointment completed",
    message: `Your appointment has been marked as completed. You can now view your prescription and medical record.`,
    type: "appointment_confirmation",
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment marked as completed."));
});

// PATCH /api/appointments/:id/no-show  (doctor)
const markNoShow = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");
  if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  if (!["pending", "confirmed"].includes(appointment.status)) {
    throw new ApiError(400, `Cannot mark "${appointment.status}" appointment as no-show.`);
  }

  appointment.status = "no_show";
  appointment.noShowAt = new Date();
  await appointment.save();

  const payment = await Payment.findOne({ appointmentId: appointment._id });
  if (payment && payment.paymentStatus === "paid") {
    // Hospital policy: no refund for no-shows (kept configurable here)
    payment.refundReason = "No refund policy applied due to no-show";
  }
  if (payment) await payment.save();

   await createAuditLog({
      req,
      action: "no_show",
      entityName: "Appointment",
      entityId: appointment._id,
      description: "Doctor marked a patient as a no-show.",
    });
    
  const patient = await Patient.findById(appointment.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Marked as no-show",
    message: `You were marked as a no-show for your appointment on ${appointment.appointmentDate}.`,
    type: "appointment_cancellation",
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment marked as no-show."));
});

// POST /api/appointments/:id/follow-up
// :id is the ORIGINAL (parent) appointment. Either the patient or the
// doctor from that appointment can book the follow-up - a doctor
// scheduling it on the spot (e.g. "come back in 2 weeks") should be able
// to confirm it immediately, while a patient booking off a recommendation
// goes through the normal pending -> accept flow like any other booking.
const createFollowUpAppointment = asyncHandler(async (req, res) => {
  const { appointmentDate, startTime, endTime, reasonForVisit, paymentMethod } = req.body;

  const parentAppointment = await Appointment.findById(req.params.id);
  if (!parentAppointment) throw new ApiError(404, "Original appointment not found.");

  if (parentAppointment.status !== "completed") {
    throw new ApiError(400, "Follow-ups can only be booked for completed appointments.");
  }

  let bookedByRole;
  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(parentAppointment.patientId) !== String(patient._id)) throw new ApiError(403, "Not your appointment.");
    if (patient.blockedDoctors.some((id) => String(id) === String(parentAppointment.doctorId))) {
      throw new ApiError(403, "You have blocked this doctor and can't book a follow-up with them.");
    }
    bookedByRole = "patient";
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(parentAppointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
    bookedByRole = "doctor";
  } else {
    throw new ApiError(403, "Only the patient or doctor from the original appointment can book a follow-up.");
  }

  // Don't let follow-ups pile up silently - if one is already pending/
  // confirmed against this parent, point them at rescheduling it instead.
  const existingFollowUp = await Appointment.findOne({
    parentAppointmentId: parentAppointment._id,
    status: { $in: ["pending", "confirmed"] },
  });
  if (existingFollowUp) {
    throw new ApiError(409, "A follow-up for this appointment is already booked. Reschedule that one instead of booking another.");
  }

  if (dayjs(appointmentDate).isBefore(dayjs().startOf("day"))) {
    throw new ApiError(400, "Cannot book an appointment in the past.");
  }

  await assertSlotIsBookable({ doctorId: parentAppointment.doctorId, appointmentDate, startTime, endTime });

  const doctor = await Doctor.findById(parentAppointment.doctorId);

  const followUp = await Appointment.create({
    patientId: parentAppointment.patientId,
    doctorId: parentAppointment.doctorId,
    appointmentDate,
    startTime,
    endTime,
    reasonForVisit: reasonForVisit || "Follow-up appointment",
    status: bookedByRole === "doctor" ? "confirmed" : "pending",
    createdBy: bookedByRole,
    isFollowUp: true,
    parentAppointmentId: parentAppointment._id,
  });

  const payment = await Payment.create({
    appointmentId: followUp._id,
    patientId: parentAppointment.patientId,
    doctorId: parentAppointment.doctorId,
    amount: doctor.consultationFee,
    paymentMethod: paymentMethod || "cash",
    paymentStatus: "pending",
  });

  const patient = await Patient.findById(parentAppointment.patientId);
  const notifyMessage = `A follow-up appointment has been ${bookedByRole === "doctor" ? "scheduled" : "requested"} for ${appointmentDate} at ${startTime}.`;

  await createNotification({
    userId: bookedByRole === "doctor" ? patient.userId : doctor.userId,
    title: bookedByRole === "doctor" ? "Follow-up appointment scheduled" : "Follow-up requested",
    message: notifyMessage,
    type: bookedByRole === "doctor" ? "appointment_confirmation" : "new_appointment",
  });

  await createAuditLog({
    req,
    action: "create_follow_up",
    entityName: "Appointment",
    entityId: followUp._id,
    description: `${bookedByRole} booked a follow-up to appointment ${parentAppointment._id}.`,
  });

  const populated = await Appointment.findById(followUp._id).populate(appointmentPopulateOptions);

  return res
    .status(StatusCodes.CREATED)
    .json(new ApiResponse(201, { appointment: populated, payment }, "Follow-up appointment booked."));
});

// GET /api/appointments/:id/follow-ups
// Lists every follow-up appointment ever booked against this one (usually
// zero or one, but nothing stops a patient from having been rescheduled/
// cancelled and rebooked more than once over time).
const getFollowUps = asyncHandler(async (req, res) => {
  const parentAppointment = await Appointment.findById(req.params.id);
  if (!parentAppointment) throw new ApiError(404, "Appointment not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(parentAppointment.patientId) !== String(patient._id)) throw new ApiError(403, "Not your appointment.");
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(parentAppointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  }

  const followUps = await Appointment.find({ parentAppointmentId: parentAppointment._id })
    .populate(appointmentPopulateOptions)
    .sort({ createdAt: -1 });

  // Surface the doctor's recommended follow-up date (if they left one on
  // the medical record) so the client can pre-fill a suggested date.
  const medicalRecord = await MedicalRecord.findOne({ appointmentId: parentAppointment._id }).select("followUpDate");

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      { followUps, recommendedFollowUpDate: medicalRecord?.followUpDate || null },
      "Follow-up appointments fetched."
    )
  );
});

module.exports = {
  createAppointment,
  getAppointments,
  getAppointmentById,
  rescheduleAppointment,
  cancelAppointment,
  acceptAppointment,
  rejectAppointment,
  checkInAppointment,
  completeAppointment,
  markNoShow,
  createFollowUpAppointment,
  getFollowUps,
  assertSlotIsBookable,
};
