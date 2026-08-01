const crypto = require("crypto");
const dayjs = require("dayjs");
const { StatusCodes } = require("http-status-codes");

const User = require("../models/User");
const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const Appointment = require("../models/Appointment");
const Payment = require("../models/Payment");
const Specialty = require("../models/Specialty");
const Notification = require("../models/Notification");
const VerificationToken = require("../models/VerificationToken");
const RefreshToken = require("../models/RefreshToken");
const Review = require("../models/Review");
const Prescription = require("../models/Prescription");
const MedicalRecord = require("../models/MedicalRecord");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const sendEmail = require("../utils/sendEmail");
const createNotification = require("../utils/createNotification");
const createAuditLog = require("../utils/createAuditLog");
const { assertSlotIsBookable } = require("./appointment.controller");

// GET /api/admin/dashboard
const getDashboard = asyncHandler(async (req, res) => {
  const today = dayjs().format("YYYY-MM-DD");

  const [totalPatients, totalDoctors, activeDoctors, totalAppointments, todaysAppointments, pendingApprovals, revenueAgg, recentActivities] =
    await Promise.all([
      Patient.countDocuments(),
      Doctor.countDocuments(),
      Doctor.countDocuments({ verificationStatus: "verified" }),
      Appointment.countDocuments(),
      Appointment.countDocuments({ appointmentDate: today }),
      Doctor.countDocuments({ verificationStatus: "pending" }),
      Payment.aggregate([{ $match: { paymentStatus: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      require("../models/AuditLog").find().sort({ createdAt: -1 }).limit(10),
    ]);

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      {
        totalPatients,
        totalDoctors,
        activeDoctors,
        totalAppointments,
        todaysAppointments,
        pendingApprovals,
        revenue: revenueAgg[0]?.total || 0,
        recentActivities,
      },
      "Admin dashboard fetched."
    )
  );
});

// ---- Patient management ----

const getPatients = asyncHandler(async (req, res) => {
  const { search, status, page = 1, limit = 10 } = req.query;
  const userFilter = { role: "patient" };
  if (status) userFilter.accountStatus = status;
  if (search) {
    userFilter.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const users = await User.find(userFilter)
    .skip((page - 1) * limit)
    .limit(Number(limit))
    .sort({ createdAt: -1 });
  const total = await User.countDocuments(userFilter);

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { patients: users, total, page: Number(page), pages: Math.ceil(total / limit) }, "Patients fetched."));
});

const getPatientById = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ userId: req.params.id }).populate("userId");
  if (!patient) throw new ApiError(404, "Patient not found.");
  return res.status(StatusCodes.OK).json(new ApiResponse(200, patient, "Patient fetched."));
});

const updatePatient = asyncHandler(async (req, res) => {
  const { firstName, lastName, phoneNumber, ...patientFields } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { ...(firstName && { firstName }), ...(lastName && { lastName }), ...(phoneNumber && { phoneNumber }) },
    { new: true }
  );
  if (!user) throw new ApiError(404, "Patient not found.");

  const patient = await Patient.findOneAndUpdate({ userId: req.params.id }, patientFields, { new: true });

  await createAuditLog({ req, action: "update", entityName: "Patient", entityId: user._id, description: "Admin edited patient account." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { user, patient }, "Patient account updated."));
});

const suspendPatient = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { accountStatus: "suspended", suspensionReason: req.body.reason },
    { new: true }
  );
  if (!user) throw new ApiError(404, "Patient not found.");

  await RefreshToken.deleteMany({ userId: user._id });
  await createAuditLog({ req, action: "suspend", entityName: "User", entityId: user._id, description: req.body.reason });
  await createNotification({ userId: user._id, title: "Account suspended", message: `Your account was suspended. Reason: ${req.body.reason}`, type: "account" });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, user, "Patient suspended."));
});

const deactivatePatient = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { accountStatus: "inactive" }, { new: true });
  if (!user) throw new ApiError(404, "Patient not found.");

  await RefreshToken.deleteMany({ userId: user._id });
  await createAuditLog({ req, action: "deactivate", entityName: "User", entityId: user._id, description: "Admin deactivated patient account." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, user, "Patient deactivated."));
});

const activatePatient = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { accountStatus: "active", suspensionReason: "" },
    { new: true }
  );
  if (!user) throw new ApiError(404, "Patient not found.");

  await createAuditLog({ req, action: "activate", entityName: "User", entityId: user._id, description: "Admin reactivated patient account." });
  await createNotification({ userId: user._id, title: "Account reactivated", message: "Your account has been reactivated.", type: "account" });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, user, "Patient activated."));
});

// ---- Doctor management ----

const createDoctor = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phoneNumber, specialtyId, licenseNumber, qualification, yearsOfExperience, consultationFee, bio } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) throw new ApiError(409, "A user with this email already exists.");

  const existingLicense = await Doctor.findOne({ licenseNumber });
  if (existingLicense) throw new ApiError(409, "A doctor with this license number already exists.");

  const specialty = await Specialty.findById(specialtyId);
  if (!specialty) throw new ApiError(404, "Specialty not found.");

  const tempPassword = crypto.randomBytes(8).toString("hex");
  const user = await User.create({
    firstName,
    lastName,
    email,
    phoneNumber,
    password: tempPassword,
    role: "doctor",
    accountStatus: "active",
    isEmailVerified: true,
  });

  const doctor = await Doctor.create({
    userId: user._id,
    specialtyId,
    licenseNumber,
    qualification: qualification || [],
    yearsOfExperience: yearsOfExperience || 0,
    consultationFee,
    bio: bio || "",
    verificationStatus: "pending",
  });

  const setupToken = crypto.randomBytes(32).toString("hex");
  await VerificationToken.create({
    userId: user._id,
    token: setupToken,
    type: "doctor_setup",
    expiresAt: dayjs().add(72, "hour").toDate(),
  });

  const setupUrl = `${process.env.CLIENT_URL}/doctor/setup-account?token=${setupToken}`;
  await sendEmail({
    to: email,
    subject: "You've been invited to join City Care Hospital",
    html: `<p>Hi Dr. ${lastName},</p><p>An account has been created for you. Set up your password here:</p><a href="${setupUrl}">${setupUrl}</a><p>This link expires in 72 hours.</p>`,
  });

  await createAuditLog({ req, action: "create", entityName: "Doctor", entityId: doctor._id, description: "Admin invited a new doctor." });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, { user, doctor }, "Doctor invited successfully."));
});

const getDoctors = asyncHandler(async (req, res) => {
  const { search, verificationStatus, specialty, page = 1, limit = 10 } = req.query;
  const filter = {};
  if (verificationStatus) filter.verificationStatus = verificationStatus;
  if (specialty) filter.specialtyId = specialty;

  let doctors = await Doctor.find(filter)
    .populate("userId", "firstName lastName email phoneNumber accountStatus")
    .populate("specialtyId", "name")
    .skip((page - 1) * limit)
    .limit(Number(limit))
    .sort({ createdAt: -1 });

  if (search) {
    const s = search.toLowerCase();
    doctors = doctors.filter(
      (d) => d.userId?.firstName?.toLowerCase().includes(s) || d.userId?.lastName?.toLowerCase().includes(s) || d.userId?.email?.toLowerCase().includes(s)
    );
  }

  const total = await Doctor.countDocuments(filter);

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { doctors, total, page: Number(page), pages: Math.ceil(total / limit) }, "Doctors fetched."));
});

const getDoctorByIdAdmin = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.id).populate("userId").populate("specialtyId", "name");
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  const [totalAppointments, completedAppointments, totalEarnings] = await Promise.all([
    Appointment.countDocuments({ doctorId: doctor._id }),
    Appointment.countDocuments({ doctorId: doctor._id, status: "completed" }),
    Payment.aggregate([{ $match: { doctorId: doctor._id, paymentStatus: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      { doctor, stats: { totalAppointments, completedAppointments, totalEarnings: totalEarnings[0]?.total || 0 } },
      "Doctor details fetched."
    )
  );
});

const updateDoctorAdmin = asyncHandler(async (req, res) => {
  const { firstName, lastName, phoneNumber, ...doctorFields } = req.body;
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  if (firstName || lastName || phoneNumber) {
    await User.findByIdAndUpdate(doctor.userId, {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(phoneNumber && { phoneNumber }),
    });
  }
  Object.assign(doctor, doctorFields);
  await doctor.save();

  await createAuditLog({ req, action: "update", entityName: "Doctor", entityId: doctor._id, description: "Admin edited doctor information." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Doctor information updated."));
});

const approveDoctor = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findByIdAndUpdate(req.params.id, { verificationStatus: "verified" }, { new: true });
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  await createAuditLog({ req, action: "approve", entityName: "Doctor", entityId: doctor._id, description: "Admin approved doctor registration." });
  await createNotification({ userId: doctor.userId, title: "Registration approved", message: "Your registration has been approved. You can now accept appointments.", type: "account" });
  await sendEmail({ to: (await User.findById(doctor.userId)).email, subject: "Your registration has been approved", html: "<p>Congratulations! Your doctor account has been verified and approved.</p>" });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Doctor approved."));
});

const verifyDoctor = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findByIdAndUpdate(
    req.params.id,
    { verificationStatus: req.body.verificationStatus || "verified", verificationNotes: req.body.notes || "" },
    { new: true }
  );
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  await createAuditLog({ req, action: "verify", entityName: "Doctor", entityId: doctor._id, description: "Admin reviewed doctor license/qualifications." });
  await createNotification({ userId: doctor.userId, title: "Verification updated", message: `Your verification status is now: ${doctor.verificationStatus}.`, type: "account" });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Doctor verification updated."));
});

const suspendDoctor = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findByIdAndUpdate(req.params.id, { verificationStatus: "suspended", verificationNotes: req.body.reason }, { new: true });
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  await User.findByIdAndUpdate(doctor.userId, { accountStatus: "suspended", suspensionReason: req.body.reason });
  await RefreshToken.deleteMany({ userId: doctor.userId });

  await createAuditLog({ req, action: "suspend", entityName: "Doctor", entityId: doctor._id, description: req.body.reason });
  await createNotification({ userId: doctor.userId, title: "Account suspended", message: `Your account was suspended. Reason: ${req.body.reason}`, type: "account" });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Doctor suspended."));
});

const activateDoctor = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findByIdAndUpdate(req.params.id, { verificationStatus: "verified" }, { new: true });
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  await User.findByIdAndUpdate(doctor.userId, { accountStatus: "active", suspensionReason: "" });

  await createAuditLog({ req, action: "activate", entityName: "Doctor", entityId: doctor._id, description: "Admin reactivated doctor account." });
  await createNotification({ userId: doctor.userId, title: "Account reactivated", message: "Your account has been reactivated.", type: "account" });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Doctor activated."));
});

const deleteDoctor = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  const activeAppointments = await Appointment.countDocuments({
    doctorId: doctor._id,
    status: { $in: ["pending", "confirmed", "checked_in", "in_progress"] },
  });
  if (activeAppointments > 0) {
    throw new ApiError(400, "Cannot delete a doctor with active appointments. Reassign or cancel them first.");
  }

  await User.findByIdAndUpdate(doctor.userId, { accountStatus: "inactive" });

  await createAuditLog({ req, action: "delete", entityName: "Doctor", entityId: doctor._id, description: "Admin deleted/deactivated doctor listing." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Doctor removed from active listings."));
});

// ---- Appointment management (admin) ----

const getAllAppointments = asyncHandler(async (req, res) => {
  const { status, doctorId, patientId, date, page = 1, limit = 10 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (doctorId) filter.doctorId = doctorId;
  if (patientId) filter.patientId = patientId;
  if (date) filter.appointmentDate = date;

  const appointments = await Appointment.find(filter)
    .populate({ path: "doctorId", populate: [{ path: "userId", select: "firstName lastName" }, { path: "specialtyId", select: "name" }] })
    .populate({ path: "patientId", populate: { path: "userId", select: "firstName lastName" } })
    .sort({ appointmentDate: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Appointment.countDocuments(filter);

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { appointments, total, page: Number(page), pages: Math.ceil(total / limit) }, "Appointments fetched."));
});

const createAppointmentAdmin = asyncHandler(async (req, res) => {
  const { patientId, doctorId, appointmentDate, startTime, endTime, reasonForVisit } = req.body;

  const patient = await Patient.findById(patientId);
  if (!patient) throw new ApiError(404, "Patient not found.");
  const doctor = await Doctor.findById(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  await assertSlotIsBookable({ doctorId, appointmentDate, startTime, endTime });

  const appointment = await Appointment.create({
    patientId,
    doctorId,
    appointmentDate,
    startTime,
    endTime,
    reasonForVisit,
    status: "confirmed",
    createdBy: "admin",
  });

  await Payment.create({ appointmentId: appointment._id, patientId, doctorId, amount: doctor.consultationFee, paymentMethod: "cash", paymentStatus: "pending" });

  await createNotification({ userId: patient.userId, title: "Appointment scheduled", message: `An appointment was scheduled for you on ${appointmentDate} at ${startTime}.`, type: "appointment_confirmation" });
  await createNotification({ userId: doctor.userId, title: "New appointment", message: `Admin scheduled an appointment for ${appointmentDate} at ${startTime}.`, type: "new_appointment" });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, appointment, "Appointment created."));
});

const updateAppointmentAdmin = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");

  Object.assign(appointment, req.body);
  await appointment.save();

  await createAuditLog({ req, action: "update", entityName: "Appointment", entityId: appointment._id, description: "Admin edited an appointment." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment updated."));
});

const cancelAppointmentAdmin = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");

  appointment.status = "cancelled";
  appointment.cancelReason = req.body.cancelReason || "Cancelled by admin";
  await appointment.save();

  const payment = await Payment.findOne({ appointmentId: appointment._id });
  if (payment && payment.paymentStatus === "paid") {
    payment.paymentStatus = "refunded";
    payment.refundAmount = payment.amount;
    payment.refundReason = "Appointment cancelled by admin";
    await payment.save();
  }

  const patient = await Patient.findById(appointment.patientId);
  const doctor = await Doctor.findById(appointment.doctorId);
  await createNotification({ userId: patient.userId, title: "Appointment cancelled", message: "Your appointment was cancelled by hospital administration.", type: "appointment_cancellation" });
  await createNotification({ userId: doctor.userId, title: "Appointment cancelled", message: "An appointment was cancelled by hospital administration.", type: "appointment_cancellation" });

  await createAuditLog({ req, action: "cancel", entityName: "Appointment", entityId: appointment._id, description: appointment.cancelReason });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment cancelled."));
});

const rescheduleAppointmentAdmin = asyncHandler(async (req, res) => {
  const { appointmentDate, startTime, endTime } = req.body;
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");

  await assertSlotIsBookable({ doctorId: appointment.doctorId, appointmentDate, startTime, endTime, excludeAppointmentId: appointment._id });

  appointment.appointmentDate = appointmentDate;
  appointment.startTime = startTime;
  appointment.endTime = endTime;
  appointment.status = "rescheduled";
  await appointment.save();

  await createAuditLog({ req, action: "reschedule", entityName: "Appointment", entityId: appointment._id, description: "Admin rescheduled an appointment." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment rescheduled."));
});

const reassignAppointment = asyncHandler(async (req, res) => {
  const { doctorId } = req.body;
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found.");

  const newDoctor = await Doctor.findById(doctorId);
  if (!newDoctor) throw new ApiError(404, "New doctor not found.");

  await assertSlotIsBookable({
    doctorId,
    appointmentDate: appointment.appointmentDate,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
  });

  const oldDoctor = await Doctor.findById(appointment.doctorId);
  appointment.doctorId = doctorId;
  await appointment.save();

  const patient = await Patient.findById(appointment.patientId);
  await createNotification({ userId: patient.userId, title: "Doctor reassigned", message: "Your appointment has been reassigned to a different doctor.", type: "schedule_change" });
  await createNotification({ userId: newDoctor.userId, title: "New appointment assigned", message: `An appointment was reassigned to you for ${appointment.appointmentDate}.`, type: "new_appointment" });
  if (oldDoctor) await createNotification({ userId: oldDoctor.userId, title: "Appointment reassigned", message: "One of your appointments was reassigned to another doctor.", type: "schedule_change" });

  await createAuditLog({ req, action: "reassign", entityName: "Appointment", entityId: appointment._id, description: `Reassigned to doctor ${doctorId}` });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointment, "Appointment reassigned."));
});

// ---- Notifications / Announcements ----

const sendAnnouncement = asyncHandler(async (req, res) => {
  const { title, message, targetRole } = req.body;

  const roleFilter = targetRole === "all" ? { role: { $in: ["patient", "doctor"] } } : { role: targetRole };
  const users = await User.find(roleFilter).select("_id email");

  await Notification.insertMany(users.map((u) => ({ userId: u._id, title, message, type: "announcement" })));

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { recipientCount: users.length }, "Announcement sent."));
});

// ---- Audit logs ----

const getAuditLogs = asyncHandler(async (req, res) => {
  const { entityName, userId, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (entityName) filter.entityName = entityName;
  if (userId) filter.userId = userId;

  const logs = await require("../models/AuditLog")
    .find(filter)
    .populate("userId", "firstName lastName email role")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await require("../models/AuditLog").countDocuments(filter);

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { logs, total, page: Number(page), pages: Math.ceil(total / limit) }, "Audit logs fetched."));
});

// GET /api/admin/doctors/:id/performance
const getDoctorPerformance = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.id)
    .populate("userId", "firstName lastName email accountStatus")
    .populate("specialtyId", "name");
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  const [appointmentsByStatus, paymentAgg, refundAgg, reviewAgg, prescriptionCount, totalAppointments] = await Promise.all([
    Appointment.aggregate([{ $match: { doctorId: doctor._id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { doctorId: doctor._id, paymentStatus: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { doctorId: doctor._id, paymentStatus: "refunded" } }, { $group: { _id: null, total: { $sum: "$refundAmount" }, count: { $sum: 1 } } }]),
    Review.aggregate([{ $match: { doctorId: doctor._id, isApproved: true } }, { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } }]),
    Prescription.countDocuments({ doctorId: doctor._id }),
    Appointment.countDocuments({ doctorId: doctor._id }),
  ]);

  const statusCounts = appointmentsByStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {});
  const completed = statusCounts.completed || 0;
  const cancelled = statusCounts.cancelled || 0;
  const noShow = statusCounts.no_show || 0;

  const performance = {
    doctor: {
      id: doctor._id,
      name: `${doctor.userId?.firstName} ${doctor.userId?.lastName}`,
      specialty: doctor.specialtyId?.name,
      verificationStatus: doctor.verificationStatus,
      accountStatus: doctor.userId?.accountStatus,
    },
    appointments: {
      total: totalAppointments,
      byStatus: statusCounts,
      completionRate: totalAppointments ? Number(((completed / totalAppointments) * 100).toFixed(1)) : 0,
      cancellationRate: totalAppointments ? Number(((cancelled / totalAppointments) * 100).toFixed(1)) : 0,
      noShowRate: totalAppointments ? Number(((noShow / totalAppointments) * 100).toFixed(1)) : 0,
    },
    earnings: {
      totalRevenue: paymentAgg[0]?.total || 0,
      paidTransactions: paymentAgg[0]?.count || 0,
      totalRefunded: refundAgg[0]?.total || 0,
      refundedTransactions: refundAgg[0]?.count || 0,
    },
    reviews: {
      averageRating: reviewAgg[0]?.avg ? Number(reviewAgg[0].avg.toFixed(2)) : 0,
      totalReviews: reviewAgg[0]?.count || 0,
    },
    prescriptionsIssued: prescriptionCount,
  };

  return res.status(StatusCodes.OK).json(new ApiResponse(200, performance, "Doctor performance report generated."));
});

// GET /api/admin/patients/:id/dashboard
// :id is the Patient document's _id (consistent with /api/admin/doctors/:id).
const getPatientDashboardAdmin = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.params.id).populate(
    "userId",
    "firstName lastName email phoneNumber accountStatus profilePicture lastLogin"
  );
  if (!patient) throw new ApiError(404, "Patient not found.");

  const [appointments, payments, medicalRecords, prescriptions, reviews, notifications] = await Promise.all([
    Appointment.find({ patientId: patient._id })
      .populate({ path: "doctorId", populate: [{ path: "userId", select: "firstName lastName" }, { path: "specialtyId", select: "name" }] })
      .sort({ appointmentDate: -1 })
      .limit(20),
    Payment.find({ patientId: patient._id }).sort({ createdAt: -1 }).limit(20),
    MedicalRecord.find({ patientId: patient._id }).sort({ createdAt: -1 }).limit(20),
    Prescription.find({ patientId: patient._id }).sort({ createdAt: -1 }).limit(20),
    Review.find({ patientId: patient._id }).sort({ createdAt: -1 }).limit(20),
    Notification.find({ userId: patient.userId }).sort({ createdAt: -1 }).limit(20),
  ]);

  const totalSpendAgg = await Payment.aggregate([
    { $match: { patientId: patient._id, paymentStatus: "paid" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  // Admins viewing full patient records touch PHI - always audit-logged.
  await createAuditLog({
    req,
    action: "view",
    entityName: "Patient",
    entityId: patient._id,
    description: "Admin viewed a patient's full dashboard (PHI access).",
  });

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      {
        patient,
        summary: {
          totalAppointments: appointments.length,
          totalSpend: totalSpendAgg[0]?.total || 0,
          totalPrescriptions: prescriptions.length,
          totalReviews: reviews.length,
        },
        appointments,
        payments,
        medicalRecords,
        prescriptions,
        reviews,
        notifications,
      },
      "Patient dashboard fetched."
    )
  );
});

module.exports = {
  getDashboard,
  getPatients,
  getPatientById,
  updatePatient,
  suspendPatient,
  deactivatePatient,
  activatePatient,
  createDoctor,
  getDoctors,
  getDoctorByIdAdmin,
  updateDoctorAdmin,
  approveDoctor,
  verifyDoctor,
  suspendDoctor,
  activateDoctor,
  deleteDoctor,
  getDoctorPerformance,
  getAllAppointments,
  createAppointmentAdmin,
  updateAppointmentAdmin,
  cancelAppointmentAdmin,
  rescheduleAppointmentAdmin,
  reassignAppointment,
  sendAnnouncement,
  getAuditLogs,
  getPatientDashboardAdmin,
};
