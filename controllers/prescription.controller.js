const { StatusCodes } = require("http-status-codes");
const dayjs = require("dayjs");

const Prescription = require("../models/Prescription");
const Appointment = require("../models/Appointment");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createNotification = require("../utils/createNotification");
const createAuditLog = require("../utils/createAuditLog");
const { streamPdfToResponse, buildPrescriptionPdf } = require("../utils/generatePdf");

// A doctor can correct a prescription right after writing it (typos, dosage
// mistakes, etc.) but not indefinitely - and never once the patient has
// actually opened it, since by then they may have already acted on it.
// Whichever comes first locks the prescription for edits.
const PRESCRIPTION_EDIT_WINDOW_HOURS = 24;

const assertPrescriptionIsEditable = (prescription) => {
  if (prescription.viewedByPatient) {
    throw new ApiError(400, "This prescription has already been viewed by the patient and can no longer be edited.");
  }
  const hoursSinceIssued = dayjs().diff(dayjs(prescription.createdAt), "hour", true);
  if (hoursSinceIssued > PRESCRIPTION_EDIT_WINDOW_HOURS) {
    throw new ApiError(
      400,
      `Prescriptions can only be edited within ${PRESCRIPTION_EDIT_WINDOW_HOURS} hours of being issued. Issue a new prescription instead.`
    );
  }
};

const populateOpts = [
  { path: "doctorId", populate: { path: "userId", select: "firstName lastName" } },
  { path: "patientId", populate: { path: "userId", select: "firstName lastName" } },
  { path: "appointmentId", select: "appointmentDate startTime status" },
];

// POST /api/prescriptions  (doctor)
const createPrescription = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const appointment = await Appointment.findById(req.body.appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found.");
  if (String(appointment.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your appointment.");
  if (appointment.status !== "completed") {
    throw new ApiError(400, "Prescriptions can only be created for completed appointments.");
  }

  const prescription = await Prescription.create({
    ...req.body,
    doctorId: doctor._id,
    patientId: appointment.patientId,
  });

  const patient = await Patient.findById(appointment.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Prescription ready",
    message: `A new prescription for ${prescription.medicationName} is ready.`,
    type: "prescription_ready",
  });

  await createAuditLog({
      req,
      action: "create",
      entityName: "Prescription",
      entityId: prescription._id,
      description: "Doctor issued a new prescription.",
    });
  
  const populated = await Prescription.findById(prescription._id).populate(populateOpts);
  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, populated, "Prescription created."));
});

// GET /api/prescriptions
const getPrescriptions = asyncHandler(async (req, res) => {
  let filter = {};
  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    filter.patientId = patient?._id;
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    filter.doctorId = doctor?._id;
  }

  const prescriptions = await Prescription.find(filter).populate(populateOpts).sort({ createdAt: -1 });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, prescriptions, "Prescriptions fetched."));
});

// GET /api/prescriptions/:id
const getPrescriptionById = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findById(req.params.id).populate(populateOpts);
  if (!prescription) throw new ApiError(404, "Prescription not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(prescription.patientId._id) !== String(patient._id)) throw new ApiError(403, "Not your prescription.");

    if (!prescription.viewedByPatient) {
      prescription.viewedByPatient = true;
      prescription.viewedAt = new Date();
      await prescription.save();
    }
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(prescription.doctorId._id) !== String(doctor._id)) throw new ApiError(403, "Not your prescription.");
  }

  return res.status(StatusCodes.OK).json(new ApiResponse(200, prescription, "Prescription fetched."));
});

// PATCH /api/prescriptions/:id  (doctor)
const updatePrescription = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const prescription = await Prescription.findById(req.params.id);
  if (!prescription) throw new ApiError(404, "Prescription not found.");
  if (String(prescription.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your prescription.");

  assertPrescriptionIsEditable(prescription);

  Object.assign(prescription, req.body);
  await prescription.save();

  const patient = await Patient.findById(prescription.patientId);
  await createNotification({
    userId: patient.userId,
    title: "Prescription updated",
    message: `Your prescription for ${prescription.medicationName} has been updated.`,
    type: "prescription_ready",
  });

  await createAuditLog({
      req,
      action: "update",
      entityName: "Prescription",
      entityId: prescription._id,
      description: "Doctor edited a prescription before it was viewed by the patient.",
    });

  const populated = await Prescription.findById(prescription._id).populate(populateOpts);
  return res.status(StatusCodes.OK).json(new ApiResponse(200, populated, "Prescription updated."));
});

// DELETE /api/prescriptions/:id  (doctor)
const deletePrescription = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const prescription = await Prescription.findById(req.params.id);
  if (!prescription) throw new ApiError(404, "Prescription not found.");
  if (String(prescription.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your prescription.");

  prescription.status = "cancelled";
  await prescription.save();

  const patient = await Patient.findById(prescription.patientId);
    await createNotification({
      userId: patient.userId,
      title: "Prescription cancelled",
      message: `Your prescription for ${prescription.medicationName} has been cancelled by your doctor.`,
      type: "prescription_ready",
    });
  
    await createAuditLog({
      req,
      action: "cancel",
      entityName: "Prescription",
      entityId: prescription._id,
      description: "Doctor cancelled a prescription.",
    });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Prescription cancelled."));
});

// GET /api/prescriptions/:id/download
const downloadPrescription = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findById(req.params.id).populate(populateOpts);
  if (!prescription) throw new ApiError(404, "Prescription not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(prescription.patientId._id) !== String(patient._id)) throw new ApiError(403, "Not your prescription.");

    if (!prescription.viewedByPatient) {
      prescription.viewedByPatient = true;
      prescription.viewedAt = new Date();
      await prescription.save();
    }
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(prescription.doctorId._id) !== String(doctor._id)) throw new ApiError(403, "Not your prescription.");
  }

  const prescriptionData = {
    prescriptionId: prescription._id,
    patient: prescription.patientId?.userId,
    doctor: prescription.doctorId?.userId,
    medicationName: prescription.medicationName,
    dosage: prescription.dosage,
    frequency: prescription.frequency,
    duration: prescription.duration,
    instructions: prescription.instructions,
    issuedAt: prescription.createdAt,
  };

  streamPdfToResponse(res, {
    filename: `prescription-${prescription._id}.pdf`,
    buildFn: (doc) => buildPrescriptionPdf(doc, prescriptionData),
  });
});

module.exports = {
  createPrescription,
  getPrescriptions,
  getPrescriptionById,
  updatePrescription,
  deletePrescription,
  downloadPrescription,
};