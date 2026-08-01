const { StatusCodes } = require("http-status-codes");
const dayjs = require("dayjs");

const Payment = require("../models/Payment");
const Appointment = require("../models/Appointment");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");

const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");

// GET /api/reports/revenue
const getRevenueReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const match = { paymentStatus: "paid" };
  if (startDate || endDate) {
    match.paidAt = {};
    if (startDate) match.paidAt.$gte = dayjs(startDate).toDate();
    if (endDate) match.paidAt.$lte = dayjs(endDate).endOf("day").toDate();
  }

  const [totals, byMonth] = await Promise.all([
    Payment.aggregate([{ $match: match }, { $group: { _id: null, totalRevenue: { $sum: "$amount" }, transactionCount: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidAt" } }, revenue: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return res.status(StatusCodes.OK).json(
    new ApiResponse(200, { totalRevenue: totals[0]?.totalRevenue || 0, transactionCount: totals[0]?.transactionCount || 0, byMonth }, "Revenue report generated.")
  );
});

// GET /api/reports/appointments
const getAppointmentsReport = asyncHandler(async (req, res) => {
  const statusBreakdown = await Appointment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  const byMonth = await Appointment.aggregate([
    { $group: { _id: { $substr: ["$appointmentDate", 0, 7] }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { statusBreakdown, byMonth }, "Appointment report generated."));
});

// GET /api/reports/doctors
const getDoctorsReport = asyncHandler(async (req, res) => {
  const doctors = await Doctor.find()
    .populate("userId", "firstName lastName")
    .populate("specialtyId", "name")
    .select("averageRating totalReviews consultationFee verificationStatus");

  const performance = await Promise.all(
    doctors.map(async (doctor) => {
      const [totalAppointments, completedAppointments, earnings] = await Promise.all([
        Appointment.countDocuments({ doctorId: doctor._id }),
        Appointment.countDocuments({ doctorId: doctor._id, status: "completed" }),
        Payment.aggregate([{ $match: { doctorId: doctor._id, paymentStatus: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      ]);
      return {
        doctor: { id: doctor._id, name: `${doctor.userId?.firstName} ${doctor.userId?.lastName}`, specialty: doctor.specialtyId?.name },
        totalAppointments,
        completedAppointments,
        earnings: earnings[0]?.total || 0,
        averageRating: doctor.averageRating,
        totalReviews: doctor.totalReviews,
      };
    })
  );

  return res.status(StatusCodes.OK).json(new ApiResponse(200, performance, "Doctor performance report generated."));
});

// GET /api/reports/patients
const getPatientsReport = asyncHandler(async (req, res) => {
  const totalPatients = await Patient.countDocuments();
  const newThisMonth = await Patient.countDocuments({ createdAt: { $gte: dayjs().startOf("month").toDate() } });

  const byGender = await Patient.aggregate([{ $group: { _id: "$gender", count: { $sum: 1 } } }]);
  const appointmentsPerPatient = await Appointment.aggregate([
    { $group: { _id: "$patientId", count: { $sum: 1 } } },
    { $group: { _id: null, avg: { $avg: "$count" } } },
  ]);

  return res.status(StatusCodes.OK).json(
    new ApiResponse(
      200,
      { totalPatients, newThisMonth, byGender, avgAppointmentsPerPatient: appointmentsPerPatient[0]?.avg || 0 },
      "Patient statistics report generated."
    )
  );
});

module.exports = { getRevenueReport, getAppointmentsReport, getDoctorsReport, getPatientsReport };
