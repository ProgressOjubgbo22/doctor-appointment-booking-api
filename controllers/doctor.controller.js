const { StatusCodes } = require("http-status-codes");
const dayjs = require("dayjs");

const User = require("../models/User");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Availability = require("../models/Availability");
const UnavailableDate = require("../models/UnavailableDate");
const Appointment = require("../models/Appointment");
const Review = require("../models/Review");
const MedicalRecord = require("../models/MedicalRecord");
const Prescription = require("../models/Prescription");
const Report = require("../models/Report");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const generateSlots = require("../utils/generateSlots");
const createAuditLog = require("../utils/createAuditLog");
const { uploadToCloudinary } = require("../config/cloudinary");

const getDoctorOr404 = async (userId) => {
  const doctor = await Doctor.findOne({ userId });
  if (!doctor) throw new ApiError(404, "Doctor profile not found.");
  return doctor;
};

// ---------------- Public endpoints ----------------

// GET /api/doctors  (list + filter)
const listDoctors = asyncHandler(async (req, res) => {
  const { specialty, minFee, maxFee, minRating, search, page = 1, limit = 10 } = req.query;

  const filter = { verificationStatus: "verified" };
  if (specialty) filter.specialtyId = specialty;
  if (minRating) filter.averageRating = { $gte: Number(minRating) };
  if (minFee || maxFee) {
    filter.consultationFee = {};
    if (minFee) filter.consultationFee.$gte = Number(minFee);
    if (maxFee) filter.consultationFee.$lte = Number(maxFee);
  }

  let query = Doctor.find(filter)
    .populate("userId", "firstName lastName profilePicture")
    .populate("specialtyId", "name");

  const doctors = await query
    .sort({ averageRating: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  let filtered = doctors;
  if (search) {
    const s = search.toLowerCase();
    filtered = doctors.filter(
      (d) =>
        d.userId?.firstName?.toLowerCase().includes(s) ||
        d.userId?.lastName?.toLowerCase().includes(s) ||
        d.specialtyId?.name?.toLowerCase().includes(s)
    );
  }

  const total = await Doctor.countDocuments(filter);

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { doctors: filtered, total, page: Number(page), pages: Math.ceil(total / limit) }, "Doctors fetched."));
});

// GET /api/doctors/search
const searchDoctors = listDoctors; // same underlying logic; kept as separate route per spec

// GET /api/doctors/:id
const getDoctorById = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.id)
    .populate("userId", "firstName lastName profilePicture phoneNumber")
    .populate("specialtyId", "name description");
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Doctor profile fetched."));
});

// GET /api/doctors/:id/availability?date=YYYY-MM-DD
const getDoctorAvailability = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  const date = req.query.date || dayjs().format("YYYY-MM-DD");
  const dayOfWeek = dayjs(date).format("dddd").toLowerCase();

  const isBlocked = await UnavailableDate.findOne({ doctorId: doctor._id, date });
  if (isBlocked) {
    return res.status(StatusCodes.OK).json(new ApiResponse(200, { date, slots: [] }, "Doctor is unavailable on this date."));
  }

  const availability = await Availability.findOne({ doctorId: doctor._id, dayOfWeek, isAvailable: true });
  if (!availability) {
    return res.status(StatusCodes.OK).json(new ApiResponse(200, { date, slots: [] }, "No availability configured for this day."));
  }

  const bookedAppointments = await Appointment.find({
    doctorId: doctor._id,
    appointmentDate: date,
    status: { $in: ["pending", "confirmed", "checked_in", "in_progress"] },
  }).select("startTime");

  const slots = generateSlots({
    date,
    startTime: availability.startTime,
    endTime: availability.endTime,
    breakStartTime: availability.breakStartTime,
    breakEndTime: availability.breakEndTime,
    bookedSlots: bookedAppointments,
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { date, slots }, "Available time slots fetched."));
});

// GET /api/doctors/:id/reviews
const getDoctorReviews = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  const reviews = await Review.find({ doctorId: doctor._id, isApproved: true })
    .populate({ path: "patientId", populate: { path: "userId", select: "firstName lastName profilePicture" } })
    .sort({ createdAt: -1 });

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      { averageRating: doctor.averageRating, totalReviews: doctor.totalReviews, reviews },
      "Doctor reviews fetched."
    )
  );
});

// GET /api/doctors/:id/qualifications
const getDoctorQualifications = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.id).select("qualification yearsOfExperience licenseNumber verificationStatus");
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Doctor qualifications fetched."));
});

// ---------------- Doctor-only endpoints ----------------

// GET /api/doctor/profile
const getMyProfile = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id })
    .populate("userId", "firstName lastName email phoneNumber profilePicture")
    .populate("specialtyId", "name");
  if (!doctor) throw new ApiError(404, "Doctor profile not found.");

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Profile fetched."));
});

// PATCH /api/doctor/profile
const updateMyProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, phoneNumber, ...doctorFields } = req.body;

  if (firstName || lastName || phoneNumber) {
    await User.findByIdAndUpdate(req.user._id, {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(phoneNumber && { phoneNumber }),
    });
  }

  const doctor = await Doctor.findOneAndUpdate({ userId: req.user._id }, doctorFields, {
    new: true,
    runValidators: true,
  }).populate("userId", "firstName lastName email phoneNumber profilePicture");

  if (!doctor) throw new ApiError(404, "Doctor profile not found.");

  return res.status(StatusCodes.OK).json(new ApiResponse(200, doctor, "Profile updated."));
});

// PATCH /api/doctor/consultation-fee
const updateConsultationFee = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOneAndUpdate(
    { userId: req.user._id },
    { consultationFee: req.body.consultationFee },
    { new: true }
  );
  if (!doctor) throw new ApiError(404, "Doctor profile not found.");

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { consultationFee: doctor.consultationFee }, "Consultation fee updated."));
});

// POST /api/doctor/profile-picture
const uploadProfilePicture = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No image file provided.");

  const result = await uploadToCloudinary(req.file.buffer, "hospital-system/profile-pictures");
  const user = await User.findByIdAndUpdate(req.user._id, { profilePicture: result.secure_url }, { new: true });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { profilePicture: user.profilePicture }, "Profile picture updated."));
});

// ---- Availability ----

// POST /api/doctor/availability
const addAvailability = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);

  const existing = await Availability.findOne({ doctorId: doctor._id, dayOfWeek: req.body.dayOfWeek });
  if (existing) throw new ApiError(409, `Availability for ${req.body.dayOfWeek} already exists. Use update instead.`);

  const availability = await Availability.create({ ...req.body, doctorId: doctor._id });
  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, availability, "Availability saved."));
});

// GET /api/doctor/availability
const getMyAvailability = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);
  const availability = await Availability.find({ doctorId: doctor._id }).sort({ dayOfWeek: 1 });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, availability, "Availability fetched."));
});

// PATCH /api/doctor/availability/:id
const updateAvailability = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);
  const availability = await Availability.findById(req.params.id);
  if (!availability) throw new ApiError(404, "Availability not found.");
  if (String(availability.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your availability record.");

  Object.assign(availability, req.body);
  await availability.save();

  return res.status(StatusCodes.OK).json(new ApiResponse(200, availability, "Availability updated."));
});

// DELETE /api/doctor/availability/:id
const deleteAvailability = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);
  const availability = await Availability.findById(req.params.id);
  if (!availability) throw new ApiError(404, "Availability not found.");
  if (String(availability.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your availability record.");

  const futureAppointments = await Appointment.countDocuments({
    doctorId: doctor._id,
    appointmentDate: { $gte: dayjs().format("YYYY-MM-DD") },
    status: { $in: ["pending", "confirmed"] },
  });
  if (futureAppointments > 0) {
    throw new ApiError(400, "Cannot delete availability while you have upcoming appointments. Consider updating instead.");
  }

  await availability.deleteOne();
  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Availability deleted."));
});

// POST /api/doctor/unavailable-dates
const addUnavailableDate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);

  const existing = await UnavailableDate.findOne({ doctorId: doctor._id, date: req.body.date });
  if (existing) throw new ApiError(409, "This date is already marked unavailable.");

  const blocked = await UnavailableDate.create({ ...req.body, doctorId: doctor._id });
  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, blocked, "Date blocked successfully."));
});

// ---- Dashboard ----

// GET /api/doctor/dashboard
const getDashboard = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);
  const today = dayjs().format("YYYY-MM-DD");

  const [todayCount, upcoming, completed, totalPatients, earningsAgg, monthEarningsAgg] = await Promise.all([
    Appointment.countDocuments({ doctorId: doctor._id, appointmentDate: today }),
    Appointment.countDocuments({
      doctorId: doctor._id,
      appointmentDate: { $gte: today },
      status: { $in: ["pending", "confirmed"] },
    }),
    Appointment.countDocuments({ doctorId: doctor._id, status: "completed" }),
    Appointment.distinct("patientId", { doctorId: doctor._id }),
    require("../models/Payment").aggregate([
      { $match: { doctorId: doctor._id, paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    require("../models/Payment").aggregate([
      {
        $match: {
          doctorId: doctor._id,
          paymentStatus: "paid",
          paidAt: { $gte: dayjs().startOf("month").toDate() },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      {
        todaysAppointments: todayCount,
        upcomingAppointments: upcoming,
        completedAppointments: completed,
        totalPatients: totalPatients.length,
        totalEarnings: earningsAgg[0]?.total || 0,
        thisMonthEarnings: monthEarningsAgg[0]?.total || 0,
      },
      "Dashboard data fetched."
    )
  );
});

// ---- Patient history (doctor viewing their patients) ----

// GET /api/doctor/patients
// Lists every patient who has ever booked an appointment with this doctor.
const getMyPatients = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);
  const { search, page = 1, limit = 10 } = req.query;

  const patientIds = await Appointment.distinct("patientId", { doctorId: doctor._id });

  const userFilter = {};
  if (search) {
    userFilter.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  let patients = await Patient.find({ _id: { $in: patientIds } })
    .populate({ path: "userId", select: "firstName lastName email phoneNumber profilePicture", match: userFilter })
    .sort({ createdAt: -1 });

  // Drop patients whose populated user didn't match the search filter
  patients = patients.filter((p) => p.userId);

  const total = patients.length;
  const paged = patients.slice((page - 1) * limit, page * limit);

  const enriched = await Promise.all(
    paged.map(async (patient) => {
      const [lastAppointment, totalAppointments] = await Promise.all([
        Appointment.findOne({ doctorId: doctor._id, patientId: patient._id }).sort({ appointmentDate: -1, startTime: -1 }),
        Appointment.countDocuments({ doctorId: doctor._id, patientId: patient._id }),
      ]);
      return { patient, lastAppointment, totalAppointments };
    })
  );

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { patients: enriched, total, page: Number(page), pages: Math.ceil(total / limit) }, "Patients fetched."));
});

// GET /api/doctor/patients/:patientId
// Full clinical history for one patient: profile, every appointment with
// this doctor, plus the patient's complete medical record / prescription
// trail (across all doctors) for continuity of care. Access is only granted
// once the patient has actually booked with this doctor at least once.
const getPatientHistory = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);

  const patient = await Patient.findById(req.params.patientId).populate(
    "userId",
    "firstName lastName email phoneNumber profilePicture"
  );
  if (!patient) throw new ApiError(404, "Patient not found.");

  const hasRelationship = await Appointment.exists({ doctorId: doctor._id, patientId: patient._id });
  if (!hasRelationship) {
    throw new ApiError(403, "You can only view the history of patients who have booked an appointment with you.");
  }

  const [appointmentsWithMe, medicalRecords, prescriptions] = await Promise.all([
    Appointment.find({ doctorId: doctor._id, patientId: patient._id }).sort({ appointmentDate: -1, startTime: -1 }),
    MedicalRecord.find({ patientId: patient._id })
      .populate({ path: "doctorId", populate: { path: "userId", select: "firstName lastName" } })
      .sort({ createdAt: -1 }),
    Prescription.find({ patientId: patient._id })
      .populate({ path: "doctorId", populate: { path: "userId", select: "firstName lastName" } })
      .sort({ createdAt: -1 }),
  ]);

  await createAuditLog({
    req,
    action: "view",
    entityName: "Patient",
    entityId: patient._id,
    description: "Doctor viewed a patient's medical history (PHI access).",
  });

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      {
        patient,
        appointmentsWithMe,
        medicalRecords, // includes records from other doctors, for continuity of care
        prescriptions, // includes prescriptions from other doctors
      },
      "Patient history fetched."
    )
  );
});

// GET /api/doctor/patients/:patientId/dashboard
// A richer, single-screen view of one patient for the doctor's UI: profile,
// appointments with this doctor, medical records, prescriptions, any
// reports attached to those records, and (optionally) the patient's review
// of this doctor. Same access rule as getPatientHistory: only patients who
// have actually booked with this doctor are visible.
const getPatientDashboardForDoctor = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);

  const patient = await Patient.findById(req.params.patientId).populate(
    "userId",
    "firstName lastName email phoneNumber profilePicture"
  );
  if (!patient) throw new ApiError(404, "Patient not found.");

  const hasAccess = await Appointment.exists({ doctorId: doctor._id, patientId: patient._id });
  if (!hasAccess) {
    throw new ApiError(403, "You can only view the dashboard of patients who have booked an appointment with you.");
  }

  const [appointments, medicalRecords, prescriptions, review] = await Promise.all([
    Appointment.find({ doctorId: doctor._id, patientId: patient._id }).sort({ appointmentDate: -1, startTime: -1 }),
    MedicalRecord.find({ doctorId: doctor._id, patientId: patient._id }).sort({ createdAt: -1 }),
    Prescription.find({ doctorId: doctor._id, patientId: patient._id }).sort({ createdAt: -1 }),
    Review.findOne({ doctorId: doctor._id, patientId: patient._id }),
  ]);

  const medicalRecordIds = medicalRecords.map((r) => r._id);
  const reports = await Report.find({ medicalRecordId: { $in: medicalRecordIds } }).sort({ createdAt: -1 });

  await createAuditLog({
    req,
    action: "view",
    entityName: "Patient",
    entityId: patient._id,
    description: "Doctor viewed a patient's dashboard (PHI access).",
  });

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      {
        patient,
        appointments,
        medicalRecords,
        prescriptions,
        reports,
        review: review || null, // optional - patient may not have left one
      },
      "Patient dashboard fetched."
    )
  );
});

// GET /api/doctor/reviews
const getMyReviews = asyncHandler(async (req, res) => {
  const doctor = await getDoctorOr404(req.user._id);

  const reviews = await Review.find({ doctorId: doctor._id })
    .populate({ path: "patientId", populate: { path: "userId", select: "firstName lastName profilePicture" } })
    .sort({ createdAt: -1 });

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      { averageRating: doctor.averageRating, totalReviews: doctor.totalReviews, reviews },
      "Your reviews fetched."
    )
  );
});

module.exports = {
  listDoctors,
  searchDoctors,
  getDoctorById,
  getDoctorAvailability,
  getDoctorReviews,
  getDoctorQualifications,
  getMyProfile,
  updateMyProfile,
  updateConsultationFee,
  uploadProfilePicture,
  addAvailability,
  getMyAvailability,
  updateAvailability,
  deleteAvailability,
  addUnavailableDate,
  getDashboard,
  getMyPatients,
  getPatientHistory,
  getPatientDashboardForDoctor,
  getMyReviews,
  getDoctorOr404,
};