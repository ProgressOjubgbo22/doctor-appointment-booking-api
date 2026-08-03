const mongoose = require("mongoose");

const supportTicketSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userRole: { type: String, enum: ["patient", "doctor"], required: true },
    subject: { type: String, required: true, maxlength: 200 },
    category: {
      type: String,
      enum: ["technical", "billing", "appointment", "account", "medical_records", "other"],
      default: "other",
    },
    status: { type: String, enum: ["open", "in_progress", "resolved", "closed"], default: "open" },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    assignedAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

supportTicketSchema.index({ status: 1, lastMessageAt: -1 });

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
