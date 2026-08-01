const { StatusCodes } = require("http-status-codes");

const Specialty = require("../models/Specialty");
const Doctor = require("../models/Doctor");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createAuditLog = require("../utils/createAuditLog");

// POST /api/specialties  (admin)
const createSpecialty = asyncHandler(async (req, res) => {
  const existing = await Specialty.findOne({ name: { $regex: `^${req.body.name}$`, $options: "i" } });
  if (existing) throw new ApiError(409, "This specialty already exists.");

  const specialty = await Specialty.create(req.body);

  await createAuditLog({ req, action: "create", entityName: "Specialty", entityId: specialty._id, description: "Admin added a new specialty." });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, specialty, "Specialty created."));
});

// GET /api/specialties  (public)
const getSpecialties = asyncHandler(async (req, res) => {
  const specialties = await Specialty.find({ isActive: true }).sort({ name: 1 });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, specialties, "Specialties fetched."));
});

// PATCH /api/specialties/:id  (admin)
const updateSpecialty = asyncHandler(async (req, res) => {
  const specialty = await Specialty.findById(req.params.id);
  if (!specialty) throw new ApiError(404, "Specialty not found.");

  if (req.body.name) {
    const duplicate = await Specialty.findOne({ name: { $regex: `^${req.body.name}$`, $options: "i" }, _id: { $ne: specialty._id } });
    if (duplicate) throw new ApiError(409, "Another specialty already has this name.");
  }

  Object.assign(specialty, req.body);
  await specialty.save();

  await createAuditLog({ req, action: "update", entityName: "Specialty", entityId: specialty._id, description: "Admin edited a specialty." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, specialty, "Specialty updated."));
});

// DELETE /api/specialties/:id  (admin)
const deleteSpecialty = asyncHandler(async (req, res) => {
  const specialty = await Specialty.findById(req.params.id);
  if (!specialty) throw new ApiError(404, "Specialty not found.");

  const assignedDoctors = await Doctor.countDocuments({ specialtyId: specialty._id });
  if (assignedDoctors > 0) {
    specialty.isActive = false;
    await specialty.save();
    await createAuditLog({ req, action: "deactivate", entityName: "Specialty", entityId: specialty._id, description: "Specialty deactivated (doctors still assigned)." });
    return res.status(StatusCodes.OK).json(new ApiResponse(200, specialty, "Specialty has assigned doctors, so it was deactivated instead of deleted."));
  }

  await specialty.deleteOne();
  await createAuditLog({ req, action: "delete", entityName: "Specialty", entityId: specialty._id, description: "Admin deleted a specialty." });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Specialty deleted."));
});

// GET /api/specialties/:id/doctors  (public)
const getDoctorsBySpecialty = asyncHandler(async (req, res) => {
  const specialty = await Specialty.findById(req.params.id);
  if (!specialty) throw new ApiError(404, "Specialty not found.");

  const { page = 1, limit = 10 } = req.query;

  const filter = { specialtyId: specialty._id, verificationStatus: "verified" };

  let doctors = await Doctor.find(filter)
    .populate({ path: "userId", select: "firstName lastName profilePicture accountStatus", match: { accountStatus: "active" } })
    .populate("specialtyId", "name")
    .sort({ averageRating: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  // Drop any doctor whose linked user account isn't active (match filter above)
  doctors = doctors.filter((d) => d.userId);

  const total = await Doctor.countDocuments(filter);

  return res.status(StatusCodes.OK).json(
    new ApiResponse(200, { specialty, doctors, total, page: Number(page), pages: Math.ceil(total / limit) }, "Doctors fetched.")
  );
});

module.exports = { createSpecialty, getSpecialties, updateSpecialty, deleteSpecialty, getDoctorsBySpecialty };
