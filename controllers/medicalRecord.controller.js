const { StatusCodes } = require("http-status-codes");

const MedicalRecord = require("../models/MedicalRecord");
const Appointment = require("../models/Appointment");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Report = require("../models/Report");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createNotification = require("../utils/createNotification");
const createAuditLog = require("../utils/createAuditLog");
const { uploadToCloudinary } = require("../config/cloudinary");

const populateOpts = [
  { path: "doctorId", populate: { path: "userId", select: "firstName lastName" } },
  { path: "patientId", populate: { path: "userId", select: "firstName lastName" } },
  { path: "appointmentId", select: "appointmentDate startTime status" },
];

// POST /api/medical-records  (doctor)
const createMedicalRecord = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const appointment = await Appointment.findById(req.body.appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found.");
  if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  if (!["checked_in", "in_progress", "completed"].includes(appointment.status)) {
    throw new ApiError(400, "Medical record can only be created once the patient has been seen.");
  }

  const record = await MedicalRecord.create({
    ...req.body,
    doctorId: doctor._id,
    patientId: appointment.patientId,
  });

  const patient = await Patient.findById(appointment.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Medical record added",
    message: "A new medical record has been added to your history.",
    type: "account",
  });

  const populated = await MedicalRecord.findById(record._id).populate(populateOpts);
  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, populated, "Medical record created."));
});

// GET /api/medical-records
const getMedicalRecords = asyncHandler(async (req, res) => {
  let filter = {};
  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    filter.patientId = patient?._id;
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    filter.doctorId = doctor?._id;
  }

  const records = await MedicalRecord.find(filter).populate(populateOpts).sort({ createdAt: -1 });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, records, "Medical records fetched."));
});

// GET /api/medical-records/:id
const getMedicalRecordById = asyncHandler(async (req, res) => {
  const record = await MedicalRecord.findById(req.params.id).populate(populateOpts);
  if (!record) throw new ApiError(404, "Medical record not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(record.patientId._id) !== String(patient._id)) throw new ApiError(403, "Access denied.");
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(record.doctorId._id) !== String(doctor._id)) throw new ApiError(403, "Access denied.");
  }

  const reports = await Report.find({ medicalRecordId: record._id });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, { record, reports }, "Medical record fetched."));
});

// PATCH /api/medical-records/:id  (doctor)
const updateMedicalRecord = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const record = await MedicalRecord.findById(req.params.id);
  if (!record) throw new ApiError(404, "Medical record not found.");
  if (String(record.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your medical record.");

  Object.assign(record, req.body);
  await record.save();

  await createAuditLog({
    req,
    action: "update",
    entityName: "MedicalRecord",
    entityId: record._id,
    description: "Doctor updated a medical record.",
  });

  const populated = await MedicalRecord.findById(record._id).populate(populateOpts);
  return res.status(StatusCodes.OK).json(new ApiResponse(200, populated, "Medical record updated."));
});

// POST /api/medical-records/:id/reports  (doctor - upload report/lab result)
const addReportToRecord = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No file provided.");

  const doctor = await Doctor.findOne({ userId: req.user._id });
  const record = await MedicalRecord.findById(req.params.id);
  if (!record) throw new ApiError(404, "Medical record not found.");
  if (String(record.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your medical record.");

  const result = await uploadToCloudinary(req.file.buffer, "hospital-system/reports");

  const report = await Report.create({
    medicalRecordId: record._id,
    patientId: record.patientId,
    uploadedBy: req.user._id,
    reportType: req.body.reportType || "other",
    title: req.body.title || req.file.originalname,
    fileUrl: result.secure_url,
    notes: req.body.notes || "",
  });

  await createAuditLog({
    req,
    action: "create",
    entityName: "Report",
    entityId: report._id,
    description: "Report uploaded and attached to medical record.",
  });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, report, "Report uploaded and attached."));
});

// POST /api/patients/reports  (patient uploads their own previous report)
const uploadPatientReport = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No file provided.");

  const patient = await Patient.findOne({ userId: req.user._id });
  const result = await uploadToCloudinary(req.file.buffer, "hospital-system/reports");

  const report = await Report.create({
    patientId: patient._id,
    uploadedBy: req.user._id,
    reportType: req.body.reportType || "other",
    title: req.body.title || req.file.originalname,
    fileUrl: result.secure_url,
    notes: req.body.notes || "",
  });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, report, "Report uploaded."));
});

module.exports = {
  createMedicalRecord,
  getMedicalRecords,
  getMedicalRecordById,
  updateMedicalRecord,
  addReportToRecord,
  uploadPatientReport,
};
