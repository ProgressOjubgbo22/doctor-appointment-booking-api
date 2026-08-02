const { StatusCodes } = require("http-status-codes");

const Complaint = require("../models/Complaint");
const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const Appointment = require("../models/Appointment");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createAuditLog = require("../utils/createAuditLog");
const createNotification = require("../utils/createNotification");

/**
 * Confirms the two parties have actually had at least one appointment
 * together before allowing a report (prevents reporting a stranger), and
 * if an appointmentId was given, confirms it actually belongs to both of
 * them. Returns the matched appointment, or null if none was specified.
 */
const assertRelationshipExists = async ({ patientId, doctorId, appointmentId }) => {
  if (appointmentId) {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) throw new ApiError(404, "Appointment not found.");
    if (String(appointment.patientId) !== String(patientId) || String(appointment.doctorId) !== String(doctorId)) {
      throw new ApiError(403, "That appointment doesn't belong to both of you.");
    }
    return appointment;
  }

  const anyAppointment = await Appointment.exists({ patientId, doctorId });
  if (!anyAppointment) {
    throw new ApiError(403, "You can only report someone you've actually had an appointment with.");
  }
  return null;
};

// POST /api/patients/doctors/:doctorId/report  (patient reports a doctor)
const reportDoctor = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ userId: req.user._id });
  const doctor = await Doctor.findById(req.params.doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  const { appointmentId, reason, description } = req.body;
  await assertRelationshipExists({ patientId: patient._id, doctorId: doctor._id, appointmentId });

  const complaint = await Complaint.create({
    reporterId: req.user._id,
    reporterRole: "patient",
    reportedUserId: doctor.userId,
    reportedRole: "doctor",
    appointmentId: appointmentId || undefined,
    reason,
    description,
  });

  await createAuditLog({
    req,
    action: "report",
    entityName: "Complaint",
    entityId: complaint._id,
    description: `Patient reported doctor ${doctor._id}. Reason: ${reason}`,
  });

  return res
    .status(StatusCodes.CREATED)
    .json(new ApiResponse(201, complaint, "Report submitted. Our team will review it."));
});

// POST /api/doctor/patients/:patientId/report  (doctor reports a patient)
const reportPatient = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const patient = await Patient.findById(req.params.patientId);
  if (!patient) throw new ApiError(404, "Patient not found.");

  const { appointmentId, reason, description } = req.body;
  await assertRelationshipExists({ patientId: patient._id, doctorId: doctor._id, appointmentId });

  const complaint = await Complaint.create({
    reporterId: req.user._id,
    reporterRole: "doctor",
    reportedUserId: patient.userId,
    reportedRole: "patient",
    appointmentId: appointmentId || undefined,
    reason,
    description,
  });

  await createAuditLog({
    req,
    action: "report",
    entityName: "Complaint",
    entityId: complaint._id,
    description: `Doctor reported patient ${patient._id}. Reason: ${reason}`,
  });

  return res
    .status(StatusCodes.CREATED)
    .json(new ApiResponse(201, complaint, "Report submitted. Our team will review it."));
});

// GET /api/patients/reports  and  GET /api/doctor/reports  (reports I've filed)
const getMyReports = asyncHandler(async (req, res) => {
  const reports = await Complaint.find({ reporterId: req.user._id }).sort({ createdAt: -1 });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, reports, "Your submitted reports fetched."));
});

// ---- Admin moderation ----

// GET /api/admin/reports
const getAllComplaints = asyncHandler(async (req, res) => {
  const { status, reportedRole, page = 1, limit = 10 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (reportedRole) filter.reportedRole = reportedRole;

  const complaints = await Complaint.find(filter)
    .populate("reporterId", "firstName lastName email role")
    .populate("reportedUserId", "firstName lastName email role accountStatus")
    .populate("appointmentId", "appointmentDate startTime status")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Complaint.countDocuments(filter);

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { complaints, total, page: Number(page), pages: Math.ceil(total / limit) }, "Reports fetched."));
});

// GET /api/admin/reports/:id
const getComplaintById = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id)
    .populate("reporterId", "firstName lastName email role")
    .populate("reportedUserId", "firstName lastName email role accountStatus")
    .populate("appointmentId");
  if (!complaint) throw new ApiError(404, "Report not found.");

  return res.status(StatusCodes.OK).json(new ApiResponse(200, complaint, "Report fetched."));
});

// PATCH /api/admin/reports/:id
const updateComplaintStatus = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw new ApiError(404, "Report not found.");

  const { status, adminNotes } = req.body;
  if (status) complaint.status = status;
  if (adminNotes !== undefined) complaint.adminNotes = adminNotes;
  await complaint.save();

  await createAuditLog({
    req,
    action: "update",
    entityName: "Complaint",
    entityId: complaint._id,
    description: `Admin updated a report to status "${complaint.status}".`,
  });

  if (status) {
    await createNotification({
      userId: complaint.reporterId,
      title: "Update on your report",
      message: `Your report has been marked as "${status.replace("_", " ")}".`,
      type: "account",
    });
  }

  return res.status(StatusCodes.OK).json(new ApiResponse(200, complaint, "Report updated."));
});

module.exports = {
  reportDoctor,
  reportPatient,
  getMyReports,
  getAllComplaints,
  getComplaintById,
  updateComplaintStatus,
};
