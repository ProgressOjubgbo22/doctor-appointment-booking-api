const { StatusCodes } = require("http-status-codes");

const SupportTicket = require("../models/SupportTicket");
const SupportMessage = require("../models/SupportMessage");
const User = require("../models/User");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const createNotification = require("../utils/createNotification");
const createAuditLog = require("../utils/createAuditLog");

const notifyAllAdmins = async ({ title, message }) => {
  const admins = await User.find({ role: "admin" }).select("_id");
  await Promise.all(admins.map((admin) => createNotification({ userId: admin._id, title, message, type: "account" })));
};

// POST /api/support/tickets  (patient or doctor opens a ticket)
const createTicket = asyncHandler(async (req, res) => {
  const { subject, category, message, priority } = req.body;

  const ticket = await SupportTicket.create({
    userId: req.user._id,
    userRole: req.user.role,
    subject,
    category,
    priority: priority || "medium",
    lastMessageAt: new Date(),
  });

  await SupportMessage.create({
    ticketId: ticket._id,
    senderId: req.user._id,
    senderRole: req.user.role,
    message,
  });

  await notifyAllAdmins({
    title: "New support ticket",
    message: `New ${category} ticket from a ${req.user.role}: "${subject}"`,
  });

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, ticket, "Support ticket created."));
});

// GET /api/support/tickets  (my own tickets)
const getMyTickets = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = { userId: req.user._id };
  if (status) filter.status = status;

  const tickets = await SupportTicket.find(filter).sort({ lastMessageAt: -1 });
  return res.status(StatusCodes.OK).json(new ApiResponse(200, tickets, "Your support tickets fetched."));
});

// GET /api/support/tickets/:id  (owner or admin)
const getTicketById = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id)
    .populate("userId", "firstName lastName email role")
    .populate("assignedAdminId", "firstName lastName");
  if (!ticket) throw new ApiError(404, "Ticket not found.");

  if (req.user.role !== "admin" && String(ticket.userId._id) !== String(req.user._id)) {
    throw new ApiError(403, "Not your ticket.");
  }

  const messages = await SupportMessage.find({ ticketId: ticket._id })
    .populate("senderId", "firstName lastName role")
    .sort({ createdAt: 1 });

  // Mark the other party's messages as read now that this user has opened the thread
  await SupportMessage.updateMany(
    { ticketId: ticket._id, senderId: { $ne: req.user._id }, isRead: false },
    { isRead: true }
  );

  return res.status(StatusCodes.OK).json(new ApiResponse(200, { ticket, messages }, "Ticket fetched."));
});

// POST /api/support/tickets/:id/messages  (owner or admin replies)
const addTicketMessage = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, "Ticket not found.");

  if (req.user.role !== "admin" && String(ticket.userId) !== String(req.user._id)) {
    throw new ApiError(403, "Not your ticket.");
  }
  if (ticket.status === "closed") {
    throw new ApiError(400, "This ticket is closed. Please open a new ticket if you need further help.");
  }

  const message = await SupportMessage.create({
    ticketId: ticket._id,
    senderId: req.user._id,
    senderRole: req.user.role,
    message: req.body.message,
  });

  ticket.lastMessageAt = new Date();
  // An admin reply moves a fresh ticket into progress; a user reply on a
  // resolved ticket reopens it rather than silently going nowhere.
  if (req.user.role === "admin" && ticket.status === "open") ticket.status = "in_progress";
  if (req.user.role !== "admin" && ticket.status === "resolved") ticket.status = "open";
  await ticket.save();

  if (req.user.role === "admin") {
    await createNotification({
      userId: ticket.userId,
      title: "New reply on your support ticket",
      message: `Support replied to "${ticket.subject}".`,
      type: "account",
    });
  } else if (ticket.assignedAdminId) {
    await createNotification({
      userId: ticket.assignedAdminId,
      title: "New message on assigned ticket",
      message: `New reply on "${ticket.subject}".`,
      type: "account",
    });
  } else {
    await notifyAllAdmins({ title: "New support message", message: `New reply on unassigned ticket: "${ticket.subject}"` });
  }

  return res.status(StatusCodes.CREATED).json(new ApiResponse(201, message, "Message sent."));
});

// PATCH /api/support/tickets/:id/close  (owner closes their own ticket)
const closeTicket = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, "Ticket not found.");
  if (String(ticket.userId) !== String(req.user._id)) throw new ApiError(403, "Not your ticket.");

  ticket.status = "closed";
  await ticket.save();

  return res.status(StatusCodes.OK).json(new ApiResponse(200, ticket, "Ticket closed."));
});

// ---- Admin ----

// GET /api/admin/support/tickets
const getAllTickets = asyncHandler(async (req, res) => {
  const { status, category, priority, assignedAdminId, page = 1, limit = 15 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;
  if (assignedAdminId) filter.assignedAdminId = assignedAdminId;

  const tickets = await SupportTicket.find(filter)
    .populate("userId", "firstName lastName email role")
    .populate("assignedAdminId", "firstName lastName")
    .sort({ lastMessageAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await SupportTicket.countDocuments(filter);

  return res
    .status(StatusCodes.OK)
    .json(new ApiResponse(200, { tickets, total, page: Number(page), pages: Math.ceil(total / limit) }, "Tickets fetched."));
});

// PATCH /api/admin/support/tickets/:id  (assign to self/another admin, change status/priority)
const updateTicketAdmin = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, "Ticket not found.");

  const { status, priority, assignedAdminId } = req.body;
  if (status) ticket.status = status;
  if (priority) ticket.priority = priority;
  if (assignedAdminId) ticket.assignedAdminId = assignedAdminId;
  await ticket.save();

  await createAuditLog({
    req,
    action: "update",
    entityName: "SupportTicket",
    entityId: ticket._id,
    description: `Admin updated ticket (status=${ticket.status}, priority=${ticket.priority}).`,
  });

  if (status) {
    await createNotification({
      userId: ticket.userId,
      title: "Support ticket updated",
      message: `Your ticket "${ticket.subject}" is now "${status.replace("_", " ")}".`,
      type: "account",
    });
  }

  return res.status(StatusCodes.OK).json(new ApiResponse(200, ticket, "Ticket updated."));
});

module.exports = {
  createTicket,
  getMyTickets,
  getTicketById,
  addTicketMessage,
  closeTicket,
  getAllTickets,
  updateTicketAdmin,
};
