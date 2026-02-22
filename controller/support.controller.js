import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import { sendEmail } from "../utils/sendEmail.js";
import { User } from "../model/user.model.js";
import { SupportTicket } from "../model/supportTicket.model.js";
import { SupportMessage } from "../model/supportMessage.model.js";
import { SupportNotification } from "../model/supportNotification.model.js";

const buildAdminEmail = (ticket, message) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2>New Support Ticket</h2>
    <p><strong>Subject:</strong> ${ticket.subject}</p>
    <p><strong>Email:</strong> ${ticket.email}</p>
    <p><strong>Phone:</strong> ${ticket.phone || "N/A"}</p>
    <p><strong>Description:</strong></p>
    <div style="padding: 12px; background: #f6f6f6; border-radius: 6px;">
      ${message.message}
    </div>
  </div>
`;

const buildUserConfirmationEmail = (ticket) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2>We received your support request</h2>
    <p>Thanks for contacting support. We will review your request and reply soon.</p>
    <p><strong>Ticket:</strong> ${ticket.subject}</p>
    <p><strong>Ticket ID:</strong> ${ticket._id}</p>
  </div>
`;

const buildUserReplyEmail = (ticket, message) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2>Support replied to your ticket</h2>
    <p><strong>Subject:</strong> ${ticket.subject}</p>
    <div style="padding: 12px; background: #f6f6f6; border-radius: 6px;">
      ${message.message}
    </div>
  </div>
`;

const notifyUserSocket = (req, userId, payload) => {
  const io = req.app.get("io");
  if (!io) return;
  io.to(`chat_${userId}`).emit("supportNotification", payload);
};

const notifyAdminsSocket = (req, payload) => {
  const io = req.app.get("io");
  if (!io) return;
  io.to("alerts").emit("supportNotification", payload);
};

const findSupportAdmins = async () => {
  return User.find({
    $or: [
      { role: "admin" },
      { role: "sub-admin", subAdminPermissions: "manage_support_tickets" },
    ],
  })
    .select("email name firstName lastName")
    .lean();
};

const buildAdminEmailRecipients = (supportAdmins = []) => {
  const emails = new Set();
  supportAdmins.forEach((admin) => {
    const adminEmail = (admin.email || "").trim();
    if (adminEmail) emails.add(adminEmail);
  });
  const envEmail = (process.env.ADMIN_EMAIL || "").trim();
  if (envEmail) emails.add(envEmail);
  return Array.from(emails);
};

export const createSupportTicket = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");

  const { email, phone, subject, description } = req.body;
  const resolvedEmail = (email || req.user?.email || "").trim();

  if (!resolvedEmail || !subject || !description) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "email, subject, and description are required"
    );
  }

  let attachment = { public_id: "", url: "" };
  if (req.file) {
    const upload = await uploadOnCloudinary(req.file.buffer);
    attachment = { public_id: upload.public_id, url: upload.secure_url };
  }

  const ticket = await SupportTicket.create({
    userId,
    email: resolvedEmail,
    phone,
    subject,
    description,
    status: "open",
    lastMessageAt: new Date(),
  });

  const message = await SupportMessage.create({
    ticketId: ticket._id,
    senderId: userId,
    senderRole: req.user?.role || "user",
    message: description,
    attachment,
  });

  const supportAdmins = await findSupportAdmins();
  const adminNotifications = supportAdmins.map((admin) => ({
    userId: admin._id,
    ticketId: ticket._id,
    type: "support_new_ticket",
    message: `New support ticket: ${subject}`,
  }));

  if (adminNotifications.length) {
    await SupportNotification.insertMany(adminNotifications);
  }

  const adminEmails = buildAdminEmailRecipients(supportAdmins);
  adminEmails.forEach((adminEmail) => {
    sendEmail(
      adminEmail,
      "New Support Ticket",
      buildAdminEmail(ticket, message)
    ).catch(() => null);
  });

  notifyAdminsSocket(req, {
    type: "support_new_ticket",
    ticketId: ticket._id,
    subject: ticket.subject,
    userId,
  });

  sendEmail(
    resolvedEmail,
    "Support request received",
    buildUserConfirmationEmail(ticket)
  ).catch(() => null);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Support ticket created",
    data: {
      ticketId: ticket._id,
      messageId: message._id,
    },
  });
});

export const replyToSupportTicket = catchAsync(async (req, res) => {
  const adminId = req.user?._id;
  const ticketId = req.params.ticketId;
  const { message } = req.body;

  if (!adminId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  if (!ticketId || !message) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "ticketId and message are required"
    );
  }

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new AppError(httpStatus.NOT_FOUND, "Ticket not found");

  let attachment = { public_id: "", url: "" };
  if (req.file) {
    const upload = await uploadOnCloudinary(req.file.buffer);
    attachment = { public_id: upload.public_id, url: upload.secure_url };
  }

  const reply = await SupportMessage.create({
    ticketId: ticket._id,
    senderId: adminId,
    senderRole: req.user?.role || "admin",
    message,
    attachment,
  });

  ticket.status = "pending";
  ticket.lastMessageAt = new Date();
  await ticket.save();

  await SupportNotification.create({
    userId: ticket.userId,
    ticketId: ticket._id,
    type: "support_admin_reply",
    message: `Support replied to your ticket: ${ticket.subject}`,
  });

  notifyUserSocket(req, ticket.userId.toString(), {
    type: "support_admin_reply",
    ticketId: ticket._id,
    subject: ticket.subject,
  });

  sendEmail(
    ticket.email,
    "Support reply received",
    buildUserReplyEmail(ticket, reply)
  ).catch(() => null);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reply sent",
    data: {
      ticketId: ticket._id,
      messageId: reply._id,
    },
  });
});

export const getSupportTickets = catchAsync(async (req, res) => {
  const { status, search } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { subject: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Support tickets fetched",
    data: {
      items: tickets,
      page,
      limit,
      total,
    },
  });
});

export const getSupportTicketDetails = catchAsync(async (req, res) => {
  const { ticketId } = req.params;
  if (!ticketId) {
    throw new AppError(httpStatus.BAD_REQUEST, "ticketId is required");
  }

  const ticket = await SupportTicket.findById(ticketId).lean();
  if (!ticket) throw new AppError(httpStatus.NOT_FOUND, "Ticket not found");

  const messages = await SupportMessage.find({ ticketId })
    .sort({ createdAt: 1 })
    .populate("senderId", "name email firstName lastName role")
    .lean();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Support ticket details fetched",
    data: {
      ticket,
      messages,
    },
  });
});
