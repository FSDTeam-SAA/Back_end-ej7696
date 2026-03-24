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

const INBOUND_TICKET_SUBJECT_REGEX = /\[ticket:\s*([a-f0-9]{24})\]/i;

const buildTicketEmailSubject = (prefix, ticket) =>
  `${prefix} [Ticket: ${ticket._id}]`;

const buildAdminEmail = (ticket, message) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2>New Support Ticket</h2>
    <p><strong>Ticket ID:</strong> ${ticket._id}</p>
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
    <p>Reply to this email to continue the conversation and keep the ticket code in the subject line.</p>
  </div>
`;

const buildUserReplyEmail = (ticket, message) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2>Support replied to your ticket</h2>
    <p><strong>Ticket ID:</strong> ${ticket._id}</p>
    <p><strong>Subject:</strong> ${ticket.subject}</p>
    <div style="padding: 12px; background: #f6f6f6; border-radius: 6px;">
      ${message.message}
    </div>
    <p style="margin-top: 12px;">Reply to this email to send another message on this ticket.</p>
  </div>
`;

const buildAdminReplyEmail = (ticket, message, senderRole = "user") => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2>New reply on support ticket</h2>
    <p><strong>Ticket ID:</strong> ${ticket._id}</p>
    <p><strong>Subject:</strong> ${ticket.subject}</p>
    <p><strong>From:</strong> ${senderRole}</p>
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

const hasSupportManagerAccess = (user) => {
  const role = user?.role?.toString().toLowerCase();
  if (role === "admin") return true;
  if (role !== "sub-admin") return false;
  const permissions = Array.isArray(user?.subAdminPermissions)
    ? user.subAdminPermissions
    : [];
  return permissions.includes("manage_support_tickets");
};

const normalizeEmailAddress = (value = "") => {
  const raw = value.toString().trim();
  if (!raw) return "";
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] || raw).trim().toLowerCase();
};

const pickInboundText = (body = {}) => {
  const candidates = [
    body["stripped-text"],
    body["body-plain"],
    body.text,
    body.message,
    body.body,
    body["Text-body"],
    body["body-html"],
    body.html,
  ];
  for (const value of candidates) {
    const text = value?.toString().trim();
    if (text) return text;
  }
  return "";
};

const extractInboundTicketId = (body = {}) => {
  const candidates = [
    body.ticketId,
    body["ticket-id"],
    body.subject,
    body.Subject,
    body["stripped-text"],
    body["body-plain"],
  ];

  for (const value of candidates) {
    const text = value?.toString() || "";
    if (!text) continue;
    const directId = text.match(/\b[a-f0-9]{24}\b/i)?.[0];
    const taggedId = text.match(INBOUND_TICKET_SUBJECT_REGEX)?.[1];
    const ticketId = taggedId || directId;
    if (ticketId) return ticketId;
  }

  return "";
};

const validateInboundSupportSecret = (req) => {
  const expectedSecret = process.env.SUPPORT_INBOUND_SECRET?.trim();
  if (!expectedSecret) return;

  const providedSecret =
    req.headers["x-support-inbound-secret"]?.toString().trim() ||
    req.body?.secret?.toString().trim() ||
    req.query?.secret?.toString().trim() ||
    "";

  if (providedSecret !== expectedSecret) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid inbound support secret");
  }
};

const notifySupportTeamOfUserReply = async (req, ticket, reply, actorId, actorRole) => {
  const supportAdmins = await findSupportAdmins();
  const adminNotifications = supportAdmins.map((admin) => ({
    userId: admin._id,
    ticketId: ticket._id,
    type: "support_user_reply",
    message: `User replied to ticket: ${ticket.subject}`,
  }));
  if (adminNotifications.length) {
    await SupportNotification.insertMany(adminNotifications);
  }

  notifyAdminsSocket(req, {
    type: "support_user_reply",
    ticketId: ticket._id,
    subject: ticket.subject,
    userId: actorId,
  });

  const adminEmails = buildAdminEmailRecipients(supportAdmins);
  adminEmails.forEach((adminEmail) => {
    sendEmail(
      adminEmail,
      buildTicketEmailSubject("New user reply on support ticket", ticket),
      buildAdminReplyEmail(ticket, reply, actorRole)
    ).catch(() => null);
  });
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
    senderEmail: resolvedEmail,
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
      buildTicketEmailSubject("New Support Ticket", ticket),
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
    buildTicketEmailSubject("Support request received", ticket),
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
  const actorId = req.user?._id;
  const actorRole = req.user?.role?.toString().toLowerCase() || "user";
  const canManageTickets = hasSupportManagerAccess(req.user);
  const ticketId = req.params.ticketId;
  const message = (
    req.body?.message ??
    req.query?.message ??
    ""
  )
    .toString()
    .trim();

  if (!actorId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  if (!ticketId || !message) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "ticketId and message are required"
    );
  }

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new AppError(httpStatus.NOT_FOUND, "Ticket not found");
  const isTicketOwner = ticket.userId?.toString() === actorId.toString();
  const isUser = actorRole === "user";

  if (!canManageTickets && !isUser) {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied.");
  }

  if (isUser && !isTicketOwner) {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied.");
  }

  let attachment = { public_id: "", url: "" };
  if (req.file) {
    const upload = await uploadOnCloudinary(req.file.buffer);
    attachment = { public_id: upload.public_id, url: upload.secure_url };
  }

  const reply = await SupportMessage.create({
    ticketId: ticket._id,
    senderId: actorId,
    senderRole: actorRole,
    senderEmail: normalizeEmailAddress(req.user?.email || ticket.email),
    message,
    attachment,
  });

  ticket.status = canManageTickets ? "pending" : "open";
  ticket.lastMessageAt = new Date();
  await ticket.save();

  if (canManageTickets) {
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
      buildTicketEmailSubject("Support reply received", ticket),
      buildUserReplyEmail(ticket, reply)
    ).catch(() => null);
  } else {
    await notifySupportTeamOfUserReply(req, ticket, reply, actorId, actorRole);
  }

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

export const receiveInboundSupportReply = catchAsync(async (req, res) => {
  validateInboundSupportSecret(req);

  const body = req.body || {};
  const ticketId = extractInboundTicketId(body);
  const inboundMessage = pickInboundText(body);
  const senderEmail = normalizeEmailAddress(
    body.from || body.sender || body["From"] || body.email
  );
  const externalMessageId = (
    body["Message-Id"] ||
    body["message-id"] ||
    body.messageId ||
    ""
  )
    .toString()
    .trim();

  if (!ticketId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Inbound email is missing a ticket id");
  }
  if (!inboundMessage) {
    throw new AppError(httpStatus.BAD_REQUEST, "Inbound email is missing a reply body");
  }

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new AppError(httpStatus.NOT_FOUND, "Ticket not found");

  if (senderEmail && normalizeEmailAddress(ticket.email) !== senderEmail) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Inbound sender email does not match the ticket owner"
    );
  }

  if (externalMessageId) {
    const existingReply = await SupportMessage.findOne({ externalMessageId }).lean();
    if (existingReply) {
      return sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Inbound reply already processed",
        data: {
          ticketId: ticket._id,
          messageId: existingReply._id,
          duplicate: true,
        },
      });
    }
  }

  const reply = await SupportMessage.create({
    ticketId: ticket._id,
    senderId: ticket.userId,
    senderRole: "user",
    senderEmail: senderEmail || normalizeEmailAddress(ticket.email),
    message: inboundMessage,
    source: "email_inbound",
    ...(externalMessageId ? { externalMessageId } : {}),
    attachment: { public_id: "", url: "" },
  });

  ticket.status = "open";
  ticket.lastMessageAt = new Date();
  await ticket.save();

  await notifySupportTeamOfUserReply(
    req,
    ticket,
    reply,
    ticket.userId?.toString(),
    "user"
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Inbound support reply processed",
    data: {
      ticketId: ticket._id,
      messageId: reply._id,
    },
  });
});

export const getSupportTickets = catchAsync(async (req, res) => {
  const requesterId = req.user?._id;
  const requesterRole = req.user?.role?.toString().toLowerCase();
  const canManageTickets = hasSupportManagerAccess(req.user);

  if (!requesterId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  if (!canManageTickets && requesterRole !== "user") {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied.");
  }

  const { status, search } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

  const filter = {};
  if (!canManageTickets) {
    filter.userId = requesterId;
  }
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
  const requesterId = req.user?._id;
  const requesterRole = req.user?.role?.toString().toLowerCase();
  const canManageTickets = hasSupportManagerAccess(req.user);

  if (!requesterId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  if (!canManageTickets && requesterRole !== "user") {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied.");
  }

  const { ticketId } = req.params;
  if (!ticketId) {
    throw new AppError(httpStatus.BAD_REQUEST, "ticketId is required");
  }

  const ticket = await SupportTicket.findById(ticketId).lean();
  if (!ticket) throw new AppError(httpStatus.NOT_FOUND, "Ticket not found");

  if (!canManageTickets && ticket.userId?.toString() !== requesterId.toString()) {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied.");
  }

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
