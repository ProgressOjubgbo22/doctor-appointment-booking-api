const { StatusCodes } = require("http-status-codes");

const Conversation = require("../models/Conversation");
const ChatMessage = require("../models/ChatMessage");
const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const Appointment = require("../models/Appointment");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createNotification = require("../utils/createNotification");

const findOrCreateConversation = async (patientId, doctorId) => {
  let conversation = await Conversation.findOne({ patientId, doctorId });
  if (!conversation) {
    conversation = await Conversation.create({ patientId, doctorId });
  }
  return conversation;
};

/**
 * Chat is only allowed between a patient and doctor who've actually had an
 * appointment together, and stops working if the patient has blocked that
 * doctor (mirrors the same rule used for booking and reporting).
 */
const assertCanChat = async (patient, doctor) => {
  const hasRelationship = await Appointment.exists({ patientId: patient._id, doctorId: doctor._id });
  if (!hasRelationship) {
    throw new ApiError(403, "You can only message someone you've had an appointment with.");
  }
  if (patient.blockedDoctors.some((id) => String(id) === String(doctor._id))) {
    throw new ApiError(403, "You have blocked this doctor and can't message them. Unblock them first if you'd like to reconnect.");
  }
};

// POST /api/chat/doctors/:doctorId/messages  (patient -> doctor)
const sendMessageToDoctor = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ userId: req.user._id });
  const doctor = await Doctor.findById(req.params.doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found.");

  await assertCanChat(patient, doctor);

  const conversation = await findOrCreateConversation(patient._id, doctor._id);

  const chatMessage = await ChatMessage.create({
    conversationId: conversation._id,
    senderId: req.user._id,
    senderRole: "patient",
    message: req.body.message,
  });

  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = req.body.message.slice(0, 140);
  await conversation.save();

  await createNotification({
    userId: doctor.userId,
    title: "New message",
    message: "You have a new message from a patient.",
    type: "account",
  });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, chatMessage, "Message sent."));
});

// POST /api/chat/patients/:patientId/messages  (doctor -> patient)
const sendMessageToPatient = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  const patient = await Patient.findById(req.params.patientId);
  if (!patient) throw new ApiError(404, "Patient not found.");

  const hasRelationship = await Appointment.exists({ patientId: patient._id, doctorId: doctor._id });
  if (!hasRelationship) {
    throw new ApiError(403, "You can only message a patient you've had an appointment with.");
  }
  if (patient.blockedDoctors.some((id) => String(id) === String(doctor._id))) {
    throw new ApiError(403, "This patient has blocked you and can't be messaged.");
  }

  const conversation = await findOrCreateConversation(patient._id, doctor._id);

  const chatMessage = await ChatMessage.create({
    conversationId: conversation._id,
    senderId: req.user._id,
    senderRole: "doctor",
    message: req.body.message,
  });

  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = req.body.message.slice(0, 140);
  await conversation.save();

  await createNotification({
    userId: patient.userId,
    title: "New message from your doctor",
    message: `New message from Dr. ${req.user.lastName}.`,
    type: "account",
  });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, chatMessage, "Message sent."));
});

// GET /api/chat/conversations  (list mine, with unread counts)
const getMyConversations = asyncHandler(async (req, res) => {
  let filter = {};
  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    filter.patientId = patient?._id;
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    filter.doctorId = doctor?._id;
  }

  const conversations = await Conversation.find(filter)
    .populate({ path: "patientId", populate: { path: "userId", select: "firstName lastName profilePicture" } })
    .populate({ path: "doctorId", populate: { path: "userId", select: "firstName lastName profilePicture" } })
    .sort({ lastMessageAt: -1 });

  const enriched = await Promise.all(
    conversations.map(async (conversation) => {
      const unreadCount = await ChatMessage.countDocuments({
        conversationId: conversation._id,
        senderId: { $ne: req.user._id },
        isRead: false,
      });
      return { conversation, unreadCount };
    })
  );

  return res.status(StatusCodes.OK).json(new ApiResponse(200, enriched, "Conversations fetched."));
});

// GET /api/chat/conversations/:id/messages
const getConversationMessages = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) throw new ApiError(404, "Conversation not found.");

  if (req.user.role === "patient") {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (String(conversation.patientId) !== String(patient._id)) throw new ApiError(403, "Not your conversation.");
  } else if (req.user.role === "doctor") {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (String(conversation.doctorId) !== String(doctor._id)) throw new ApiError(403, "Not your conversation.");
  } else {
    throw new ApiError(403, "Not authorized.");
  }

  const { page = 1, limit = 50 } = req.query;
  const messages = await ChatMessage.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  // Mark the other party's messages as read now that this user has opened the thread
  await ChatMessage.updateMany(
    { conversationId: conversation._id, senderId: { $ne: req.user._id }, isRead: false },
    { isRead: true, readAt: new Date() }
  );

  return res.status(StatusCodes.OK).json(new ApiResponse(200, messages.reverse(), "Messages fetched."));
});

module.exports = { sendMessageToDoctor, sendMessageToPatient, getMyConversations, getConversationMessages };
