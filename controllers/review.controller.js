const { StatusCodes } = require("http-status-codes");
const dayjs = require("dayjs");

const Review = require("../models/Review");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Appointment = require("../models/Appointment");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createNotification = require("../utils/createNotification");
const createAuditLog = require("../utils/createAuditLog");

// Patients can edit their own review for this many hours after posting it.
// Kept generous (48h) so a patient can still fix a typo/second thought
// a day or two later, but not rewrite history on an old review.
const REVIEW_EDIT_WINDOW_HOURS = 48;

const recalculateDoctorRating = async (doctorId) => {
  const stats = await Review.aggregate([
    { $match: { doctorId, isApproved: true } },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  await Doctor.findByIdAndUpdate(doctorId, {
    averageRating: stats[0]?.avg ? Number(stats[0].avg.toFixed(2)) : 0,
    totalReviews: stats[0]?.count || 0,
  });
};

// POST /api/reviews  (patient)
const createReview = asyncHandler(async (req, res) => {
  const { appointmentId, rating, comment } = req.body;

  const patient = await Patient.findOne({ userId: req.user._id });
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found.");
  if (String(appointment.patientId) !== String(patient._id)) throw new ApiError(403, "Not your appointment.");
  if (appointment.status !== "completed") throw new ApiError(400, "You can only review completed appointments.");

  const existing = await Review.findOne({ appointmentId, patientId: patient._id });
  if (existing) throw new ApiError(409, "You have already reviewed this appointment.");

  const review = await Review.create({
    patientId: patient._id,
    doctorId: appointment.doctorId,
    appointmentId,
    rating,
    comment,
  });

  await recalculateDoctorRating(appointment.doctorId);

  const doctor = await Doctor.findById(appointment.doctorId);
  await createNotification({
    userId: doctor.userId,
    title: "New review received",
    message: `You received a new ${rating}-star review.`,
    type: "review",
  });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, review, "Review submitted."));
});

// GET /api/reviews
const getReviews = asyncHandler(async (req, res) => {
  const { doctorId, patientId } = req.query;
  const filter = { isApproved: true };
  if (doctorId) filter.doctorId = doctorId;
  if (patientId) filter.patientId = patientId;

  const reviews = await Review.find(filter)
    .populate({ path: "patientId", populate: { path: "userId", select: "firstName lastName profilePicture" } })
    .populate({ path: "doctorId", populate: { path: "userId", select: "firstName lastName" } })
    .sort({ createdAt: -1 });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, reviews, "Reviews fetched."));
});

// PATCH /api/reviews/:id  (patient - own review)
const updateReview = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ userId: req.user._id });
  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(404, "Review not found.");
  if (String(review.patientId) !== String(patient._id)) throw new ApiError(403, "Not your review.");

  const hoursSincePosted = dayjs().diff(dayjs(review.createdAt), "hour", true);
    if (hoursSincePosted > REVIEW_EDIT_WINDOW_HOURS) {
      throw new ApiError(
        400,
        `Reviews can only be edited within ${REVIEW_EDIT_WINDOW_HOURS} hours of posting. This review is no longer editable.`
      );
    }

  Object.assign(review, req.body);
  await review.save();
  await recalculateDoctorRating(review.doctorId);

  await createAuditLog({
      req,
      action: "update",
      entityName: "Review",
      entityId: review._id,
      description: "Patient edited their review.",
    });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, review, "Review updated."));
});

// DELETE /api/reviews/:id  (patient own, or admin moderation)
const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(404, "Review not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(review.patientId) !== String(patient._id)) throw new ApiError(403, "Not your review.");
  } else if (req.user.role !== "admin") {
    throw new ApiError(403, "Not authorized to delete this review.");
  }

  await review.deleteOne();
  await recalculateDoctorRating(review.doctorId);

    await createAuditLog({
      req,
      action: "delete",
      entityName: "Review",
      entityId: review._id,
      description: req.user.role === "admin" ? "Admin deleted an inappropriate review." : "Patient deleted their own review.",
    });

  return res.status(StatusCodes.OK).json(new ApiResponse(200, null, "Review deleted."));
});

// PATCH /api/reviews/:id/moderate (admin)
const moderateReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(StatusCodes.NOT_FOUND, "Review not found");

  review.isApproved = req.body.isApproved;
  await review.save();
  await recalculateDoctorRating(review.doctorId);

  await createAuditLog({
    req,
    action: "REVIEW_MODERATED",
    entityName: "Review",
    entityId: review._id,
    description: `Set isApproved=${req.body.isApproved}`,
  });

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, review, "Review moderated"));
});

module.exports = { createReview, getReviews, updateReview, deleteReview, recalculateDoctorRating, moderateReview };
