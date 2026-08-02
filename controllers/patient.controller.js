const { StatusCodes } = require("http-status-codes");
const dayjs = require("dayjs");

const User = require("../models/User");
const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const Appointment = require("../models/Appointment");
const MedicalRecord = require("../models/MedicalRecord");
const Prescription = require("../models/Prescription");
const EmergencyContact = require("../models/EmergencyContact");
const Address = require("../models/Address");
const Payment = require("../models/Payment");
const Review = require("../models/Review");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createAuditLog = require("../utils/createAuditLog");
const { uploadToCloudinary } = require("../config/cloudinary");

const getPatientOr404 = async (userId) => {
  const patient = await Patient.findOne({ userId });
  if (!patient) throw new ApiError(404, "Patient profile not found.");
  return patient;
};

// GET /api/patients/profile
const getProfile = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ userId: req.user._id }).populate(
    "userId",
    "firstName lastName email phoneNumber profilePicture"
  );
  if (!patient) throw new ApiError(404, "Patient profile not found.");
  return res.status(StatusCodes.OK).json(new ApiResponse(200, patient, "Profile fetched."));
});

// PATCH /api/patients/profile
const updateProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, phoneNumber, ...patientFields } = req.body;

  if (firstName || lastName || phoneNumber) {
    await User.findByIdAndUpdate(req.user._id, {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(phoneNumber && { phoneNumber }),
    });
  }

  const patient = await Patient.findOneAndUpdate({ userId: req.user._id }, patientFields, {
    new: true,
    runValidators: true,
  }).populate("userId", "firstName lastName email phoneNumber profilePicture");

  if (!patient) throw new ApiError(404, "Patient profile not found.");

  return res.status(StatusCodes.OK).json(new ApiResponse(200, patient, "Profile updated."));
});

// DELETE /api/patients/profile
const deleteAccount = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);

  const upcoming = await Appointment.findOne({
    patientId: patient._id,
    status: { $in: ["pending", "confirmed"] },
  });
  if (upcoming) {
    throw new ApiError(400, "Cannot delete account while you have pending or confirmed appointments.");
  }

  await User.findByIdAndUpdate(req.user._id, { accountStatus: "inactive" });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Account deactivated successfully."));
});

// POST /api/patients/profile-picture
const uploadProfilePicture = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No image file provided.");

  const result = await uploadToCloudinary(req.file.buffer, "hospital-system/profile-pictures");
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { profilePicture: result.secure_url },
    { new: true }
  );

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { profilePicture: user.profilePicture }, "Profile picture updated."));
});

// GET /api/patients/dashboard
const getDashboard = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);

  const [total, completed, pending, upcoming, unpaid] = await Promise.all([
    Appointment.countDocuments({ patientId: patient._id }),
    Appointment.countDocuments({ patientId: patient._id, status: "completed" }),
    Appointment.countDocuments({ patientId: patient._id, status: "pending" }),
    Appointment.find({
      patientId: patient._id,
      appointmentDate: { $gte: dayjs().format("YYYY-MM-DD") },
      status: { $in: ["pending", "confirmed"] },
    })
      .sort({ appointmentDate: 1, startTime: 1 })
      .limit(5)
      .populate({ path: "doctorId", populate: [{ path: "userId", select: "firstName lastName" }, { path: "specialtyId", select: "name" }] }),
    Payment.aggregate([
      { $match: { patientId: patient._id, paymentStatus: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      {
        totalAppointments: total,
        completedAppointments: completed,
        pendingAppointments: pending,
        upcomingAppointments: upcoming,
        outstandingBalance: unpaid[0]?.total || 0,
      },
      "Dashboard data fetched."
    )
  );
});

// GET /api/patients/medical-records
const getMedicalRecords = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const records = await MedicalRecord.find({ patientId: patient._id })
    .populate({ path: "doctorId", populate: { path: "userId", select: "firstName lastName" } })
    .populate("appointmentId", "appointmentDate startTime status")
    .sort({ createdAt: -1 });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, records, "Medical records fetched."));
});

// GET /api/patients/prescriptions
const getPrescriptions = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const prescriptions = await Prescription.find({ patientId: patient._id })
    .populate({ path: "doctorId", populate: { path: "userId", select: "firstName lastName" } })
    .populate("appointmentId", "appointmentDate startTime")
    .sort({ createdAt: -1 });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, prescriptions, "Prescriptions fetched."));
});

// GET /api/patients/appointments
const getAppointments = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const { status, page = 1, limit = 10 } = req.query;

  const filter = { patientId: patient._id };
  if (status) filter.status = status;

  const appointments = await Appointment.find(filter)
    .populate({ path: "doctorId", populate: [{ path: "userId", select: "firstName lastName profilePicture" }, { path: "specialtyId", select: "name" }] })
    .sort({ appointmentDate: -1, startTime: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Appointment.countDocuments(filter);

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { appointments, total, page: Number(page), pages: Math.ceil(total / limit) }, "Appointments fetched."));
});

// GET /api/patients/upcoming-appointments
const getUpcomingAppointments = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const appointments = await Appointment.find({
    patientId: patient._id,
    appointmentDate: { $gte: dayjs().format("YYYY-MM-DD") },
    status: { $in: ["pending", "confirmed", "checked_in", "in_progress"] },
  })
    .populate({ path: "doctorId", populate: [{ path: "userId", select: "firstName lastName profilePicture" }, { path: "specialtyId", select: "name" }] })
    .sort({ appointmentDate: 1, startTime: 1 });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, appointments, "Upcoming appointments fetched."));
});

// ---- Emergency Contacts ----

const addEmergencyContact = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const contact = await EmergencyContact.create({ ...req.body, patientId: patient._id });
  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, contact, "Emergency contact added."));
});

const getEmergencyContacts = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const contacts = await EmergencyContact.find({ patientId: patient._id });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, contacts, "Emergency contacts fetched."));
});

const updateEmergencyContact = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const contact = await EmergencyContact.findById(req.params.id);
  if (!contact) throw new ApiError(404, "Emergency contact not found.");
  if (String(contact.patientId) !== String(patient._id)) throw new ApiError(403, "Not your emergency contact.");

  Object.assign(contact, req.body);
  await contact.save();

  return res.status(StatusCodes.OK).json(new ApiResponse(200, contact, "Emergency contact updated."));
});

const deleteEmergencyContact = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const contact = await EmergencyContact.findById(req.params.id);
  if (!contact) throw new ApiError(404, "Emergency contact not found.");
  if (String(contact.patientId) !== String(patient._id)) throw new ApiError(403, "Not your emergency contact.");

  await contact.deleteOne();
  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Emergency contact deleted."));
});

// ---- Addresses ----

const addAddress = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);

  if (req.body.isDefault) {
    await Address.updateMany({ patientId: patient._id }, { isDefault: false });
  }

  const address = await Address.create({ ...req.body, patientId: patient._id });
  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, address, "Address added."));
});

const getAddresses = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const addresses = await Address.find({ patientId: patient._id }).sort({ isDefault: -1, createdAt: -1 });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, addresses, "Addresses fetched."));
});

const updateAddress = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const address = await Address.findById(req.params.id);
  if (!address) throw new ApiError(404, "Address not found.");
  if (String(address.patientId) !== String(patient._id)) throw new ApiError(403, "Not your address.");

  if (req.body.isDefault) {
    await Address.updateMany({ patientId: patient._id }, { isDefault: false });
  }

  Object.assign(address, req.body);
  await address.save();

  return res.status(StatusCodes.OK).json(new ApiResponse(200, address, "Address updated."));
});

const deleteAddress = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const address = await Address.findById(req.params.id);
  if (!address) throw new ApiError(404, "Address not found.");
  if (String(address.patientId) !== String(patient._id)) throw new ApiError(403, "Not your address.");

  await address.deleteOne();
  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Address deleted."));
});

// ---- Favorites ----

const addFavoriteDoctor = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const doctor = await Doctor.findById(req.params.doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  if (patient.favoriteDoctors.some((id) => String(id) === String(doctor._id))) {
    throw new ApiError(409, "Doctor is already in your favorites.");
  }

  patient.favoriteDoctors.push(doctor._id);
  await patient.save();

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Doctor added to favorites."));
});

const removeFavoriteDoctor = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  patient.favoriteDoctors = patient.favoriteDoctors.filter(
    (id) => String(id) !== String(req.params.doctorId)
  );
  await patient.save();

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Doctor removed from favorites."));
});

// ---- Blocking ----
// A patient who had a bad experience can block a doctor so future booking
// attempts with that doctor are rejected. Blocking doesn't touch past
// appointments/records and doesn't notify the doctor - it's a one-sided
// safety control, not a dispute mechanism (use reportDoctor for that).

// POST /api/patients/doctors/:doctorId/block
const blockDoctor = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  const doctor = await Doctor.findById(req.params.doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  if (patient.blockedDoctors.some((id) => String(id) === String(doctor._id))) {
    throw new ApiError(409, "You have already blocked this doctor.");
  }

  patient.blockedDoctors.push(doctor._id);
  patient.favoriteDoctors = patient.favoriteDoctors.filter((id) => String(id) !== String(doctor._id));
  await patient.save();

  await createAuditLog({
    req,
    action: "block",
    entityName: "Doctor",
    entityId: doctor._id,
    description: "Patient blocked a doctor.",
  });

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, null, "Doctor blocked. You won't be able to book with them again unless you unblock them."));
});

// DELETE /api/patients/doctors/:doctorId/block
const unblockDoctor = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);
  patient.blockedDoctors = patient.blockedDoctors.filter((id) => String(id) !== String(req.params.doctorId));
  await patient.save();

  await createAuditLog({
    req,
    action: "unblock",
    entityName: "Doctor",
    entityId: req.params.doctorId,
    description: "Patient unblocked a doctor.",
  });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Doctor unblocked."));
});

// GET /api/patients/blocked-doctors
const getBlockedDoctors = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ userId: req.user._id }).populate({
    path: "blockedDoctors",
    populate: [
      { path: "userId", select: "firstName lastName profilePicture" },
      { path: "specialtyId", select: "name" },
    ],
  });
  if (!patient) throw new ApiError(404, "Patient profile not found.");

  return res.status(StatusCodes.OK).json(new ApiResponse(200, patient.blockedDoctors, "Blocked doctors fetched."));
});

// ---- Doctor history (patient viewing their own history with a doctor) ----

// GET /api/patients/doctors/:doctorId/history
const getDoctorHistory = asyncHandler(async (req, res) => {
  const patient = await getPatientOr404(req.user._id);

  const doctor = await Doctor.findById(req.params.doctorId)
    .populate("userId", "firstName lastName profilePicture")
    .populate("specialtyId", "name");
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  const [appointments, prescriptions, medicalRecords, myReview] = await Promise.all([
    Appointment.find({ patientId: patient._id, doctorId: doctor._id }).sort({ appointmentDate: -1, startTime: -1 }),
    Prescription.find({ patientId: patient._id, doctorId: doctor._id }).sort({ createdAt: -1 }),
    MedicalRecord.find({ patientId: patient._id, doctorId: doctor._id }).sort({ createdAt: -1 }),
    Review.findOne({ patientId: patient._id, doctorId: doctor._id }),
  ]);

  if (appointments.length === 0) {
    throw new ApiError(404, "You have no appointment history with this doctor yet.");
  }

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      { doctor, appointments, prescriptions, medicalRecords, myReview },
      "Doctor visit history fetched."
    )
  );
});

module.exports = {
  getProfile,
  updateProfile,
  deleteAccount,
  uploadProfilePicture,
  getDashboard,
  getMedicalRecords,
  getPrescriptions,
  getAppointments,
  getUpcomingAppointments,
  addEmergencyContact,
  getEmergencyContacts,
  updateEmergencyContact,
  deleteEmergencyContact,
  addAddress,
  getAddresses,
  updateAddress,
  deleteAddress,
  addFavoriteDoctor,
  removeFavoriteDoctor,
  blockDoctor,
  unblockDoctor,
  getBlockedDoctors,
  getDoctorHistory,
};
