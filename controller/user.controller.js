import httpStatus from "http-status";
import { User } from "../model/user.model.js";
import { ExamAccess } from "../model/examAccess.model.js";
import { Exam } from "../model/exam.model.js";
import { ExamAttempt } from "../model/examAttempt.model.js";
import { ExamRating } from "../model/examRating.model.js";
import { generateOTP, uploadOnCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { createToken } from "../utils/authToken.js";
import { sendEmail } from "../utils/sendEmail.js";

const safeUserSelect =
  "-password -refreshToken -verificationInfo -password_reset_token";

const SUB_ADMIN_PERMISSIONS = [
  "view_user_list",
  "send_password_reset_email",
  "suspend_users",
  "manage_exams_questions",
  "view_billing_summary",
  "edit_user_profiles",
  "manage_subscription",
  "manage_announcements",
  "access_performance_analytics",
  "view_activity_logs",
  "manual_exam_unlocks",
  "credential_management",
];

const parseStatus = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = value.toString().toLowerCase();
  if (!["active", "inactive"].includes(normalized)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Status must be active or inactive");
  }
  return normalized;
};

const parseRole = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = value.toString().toLowerCase();
  if (!["user", "admin", "sub-admin", "storeman"].includes(normalized)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Role must be user, sub-admin, admin, or storeman"
    );
  }
  return normalized;
};

const parseTier = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = value.toString().toLowerCase();
  if (!["starter", "professional"].includes(normalized)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Subscription tier must be starter or professional"
    );
  }
  return normalized;
};

const parsePermissions = (value) => {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value : [value];
  const normalized = raw
    .map((p) => p?.toString().trim().toLowerCase())
    .filter(Boolean);
  const invalid = normalized.filter((p) => !SUB_ADMIN_PERMISSIONS.includes(p));
  if (invalid.length) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid permissions: ${invalid.join(", ")}`
    );
  }
  return [...new Set(normalized)];
};

const parseIfJson = (value, fieldName) => {
  if (typeof value !== "string") return value;
  if (value.trim() === "") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid JSON for ${fieldName}`
    );
  }
};

export const getProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select(safeUserSelect);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile fetched",
    data: user,
  });
});

export const getUsers = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  const statusFilter = parseStatus(req.query.status);
  if (statusFilter) filter.status = statusFilter;
  const roleFilter = parseRole(req.query.role);
  if (roleFilter) filter.role = roleFilter;
  const tierFilter = parseTier(req.query.tier);
  if (tierFilter) filter.subscriptionTier = tierFilter;

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(safeUserSelect)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  const userIds = users.map((u) => u._id);
  const accesses = userIds.length
    ? await ExamAccess.find({
        userId: { $in: userIds },
        status: "unlocked",
      }).lean()
    : [];

  const examIds = [
    ...new Set(accesses.map((access) => access.examId?.toString()).filter(Boolean)),
  ];

  const exams = examIds.length
    ? await Exam.find({ _id: { $in: examIds } }).select("name").lean()
    : [];

  const examMap = exams.reduce((acc, exam) => {
    acc[exam._id.toString()] = exam.name;
    return acc;
  }, {});

  const unlockedMap = accesses.reduce((acc, access) => {
    const key = access.userId.toString();
    if (!acc[key]) acc[key] = [];
    acc[key].push({
      examId: access.examId,
      examName: examMap[access.examId?.toString()] || null,
      purchaseType: access.purchaseType || null,
      paymentStatus: access.paymentStatus || null,
      purchasedAt: access.purchasedAt || null,
    });
    return acc;
  }, {});

  const scoreMatch = userIds.length
    ? { userId: { $in: userIds }, score: { $ne: null } }
    : null;

  const [overallAgg, perExamAgg] = scoreMatch
    ? await Promise.all([
        ExamAttempt.aggregate([
          { $match: scoreMatch },
          {
            $group: {
              _id: "$userId",
              avgScore: { $avg: "$score" },
              attempts: { $sum: 1 },
            },
          },
        ]),
        ExamAttempt.aggregate([
          { $match: scoreMatch },
          {
            $group: {
              _id: { userId: "$userId", examId: "$examId" },
              avgScore: { $avg: "$score" },
              attempts: { $sum: 1 },
            },
          },
        ]),
      ])
    : [[], []];

  const overallMap = overallAgg.reduce((acc, item) => {
    acc[item._id.toString()] = {
      avgScore: Number((item.avgScore ?? 0).toFixed(2)),
      attempts: item.attempts || 0,
    };
    return acc;
  }, {});

  const perExamIds = [
    ...new Set(
      perExamAgg
        .map((item) => item?._id?.examId?.toString())
        .filter(Boolean)
    ),
  ];
  const perExamDocs = perExamIds.length
    ? await Exam.find({ _id: { $in: perExamIds } }).select("name").lean()
    : [];
  const perExamNameMap = perExamDocs.reduce((acc, exam) => {
    acc[exam._id.toString()] = exam.name;
    return acc;
  }, {});

  const perExamMap = perExamAgg.reduce((acc, item) => {
    const userKey = item?._id?.userId?.toString();
    const examKey = item?._id?.examId?.toString();
    if (!userKey || !examKey) return acc;
    if (!acc[userKey]) acc[userKey] = [];
    acc[userKey].push({
      examId: item._id.examId,
      examName: perExamNameMap[examKey] || null,
      avgScore: Number((item.avgScore ?? 0).toFixed(2)),
      attempts: item.attempts || 0,
    });
    return acc;
  }, {});

  const enrichedUsers = users.map((user) => {
    const unlockedExams = unlockedMap[user._id.toString()] || [];
    const scoreInfo = overallMap[user._id.toString()];
    const avgScoreByExam = perExamMap[user._id.toString()] || [];
    return {
      ...user,
      unlockedExams,
      unlockedExamCount: unlockedExams.length,
      avgScore: scoreInfo?.avgScore ?? 0,
      avgScoreByExam,
    };
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users fetched",
    data: {
      users: enrichedUsers,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    },
  });
});

export const getUserDetails = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id).select(safeUserSelect).lean();

  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const accesses = await ExamAccess.find({
    userId: user._id,
    status: "unlocked",
  }).lean();

  const examIds = [
    ...new Set(accesses.map((access) => access.examId?.toString()).filter(Boolean)),
  ];
  const exams = examIds.length
    ? await Exam.find({ _id: { $in: examIds } }).select("name").lean()
    : [];
  const examMap = exams.reduce((acc, exam) => {
    acc[exam._id.toString()] = exam.name;
    return acc;
  }, {});

  const unlockedExams = accesses.map((access) => ({
    examId: access.examId,
    examName: examMap[access.examId?.toString()] || null,
    purchaseType: access.purchaseType || null,
    paymentStatus: access.paymentStatus || null,
    purchasedAt: access.purchasedAt || null,
  }));

  const [overallAgg, perExamAgg] = await Promise.all([
    ExamAttempt.aggregate([
      { $match: { userId: user._id, score: { $ne: null } } },
      {
        $group: {
          _id: "$userId",
          avgScore: { $avg: "$score" },
          attempts: { $sum: 1 },
        },
      },
    ]),
    ExamAttempt.aggregate([
      { $match: { userId: user._id, score: { $ne: null } } },
      {
        $group: {
          _id: { userId: "$userId", examId: "$examId" },
          avgScore: { $avg: "$score" },
          attempts: { $sum: 1 },
        },
      },
    ]),
  ]);

  const avgScore = overallAgg.length
    ? Number((overallAgg[0].avgScore ?? 0).toFixed(2))
    : 0;

  const perExamIds = [
    ...new Set(
      perExamAgg
        .map((item) => item?._id?.examId?.toString())
        .filter(Boolean)
    ),
  ];
  const perExamDocs = perExamIds.length
    ? await Exam.find({ _id: { $in: perExamIds } }).select("name").lean()
    : [];
  const perExamNameMap = perExamDocs.reduce((acc, exam) => {
    acc[exam._id.toString()] = exam.name;
    return acc;
  }, {});

  const avgScoreByExam = perExamAgg.map((item) => {
    const examKey = item?._id?.examId?.toString();
    return {
      examId: item._id.examId,
      examName: examKey ? perExamNameMap[examKey] || null : null,
      avgScore: Number((item.avgScore ?? 0).toFixed(2)),
      attempts: item.attempts || 0,
    };
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User details fetched",
    data: {
      ...user,
      unlockedExams,
      unlockedExamCount: unlockedExams.length,
      avgScore,
      avgScoreByExam,
    },
  });
});

export const getUserExamReviews = catchAsync(async (req, res) => {
  const userId = req.params.id;
  if (!userId) {
    throw new AppError(httpStatus.BAD_REQUEST, "User ID is required");
  }

  const reviews = await ExamRating.find({ userId })
    .sort({ updatedAt: -1 })
    .lean();

  const examIds = [
    ...new Set(reviews.map((r) => r.examId?.toString()).filter(Boolean)),
  ];
  const exams = examIds.length
    ? await Exam.find({ _id: { $in: examIds } }).select("name").lean()
    : [];
  const examMap = exams.reduce((acc, exam) => {
    acc[exam._id.toString()] = exam.name;
    return acc;
  }, {});

  const data = reviews.map((review) => ({
    reviewId: review._id,
    examId: review.examId,
    examName: examMap[review.examId?.toString()] || null,
    stars: review.stars,
    feedbackText: review.feedbackText,
    displayName: review.displayName,
    status: review.status,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  }));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User exam reviews fetched",
    data,
  });
});

export const deleteUser = catchAsync(async (req, res) => {
  const deletedUser = await User.findByIdAndDelete(req.params.id);

  if (!deletedUser) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User deleted successfully",
    data: null,
  });
});

export const updateUserStatus = catchAsync(async (req, res) => {
  const status = parseStatus(req.body.status);
  if (!status) {
    throw new AppError(httpStatus.BAD_REQUEST, "Status is required");
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  user.status = status;
  await user.save();

  const sanitizedUser = await User.findById(req.params.id).select(safeUserSelect);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User status updated",
    data: sanitizedUser,
  });
});

export const updateUserSubscription = catchAsync(async (req, res) => {
  const tier = parseTier(req.body.subscriptionTier);
  if (!tier) {
    throw new AppError(httpStatus.BAD_REQUEST, "Subscription tier is required");
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  user.subscriptionTier = tier;
  await user.save();

  const sanitizedUser = await User.findById(req.params.id).select(safeUserSelect);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User subscription updated",
    data: sanitizedUser,
  });
});

export const updateSubAdminPermissions = catchAsync(async (req, res) => {
  const permissions = parsePermissions(req.body.permissions);
  if (!permissions) {
    throw new AppError(httpStatus.BAD_REQUEST, "Permissions are required");
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  if (user.role !== "sub-admin") {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Permissions can only be set for sub-admin users"
    );
  }

  user.subAdminPermissions = permissions;
  await user.save();

  const sanitizedUser = await User.findById(req.params.id).select(safeUserSelect);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sub-admin permissions updated",
    data: sanitizedUser,
  });
});

export const adminSendPasswordResetEmail = catchAsync(async (req, res) => {
  const userId = req.params.id;
  if (!userId) {
    throw new AppError(httpStatus.BAD_REQUEST, "User ID is required");
  }

  const user = await User.findById(userId).select("+password_reset_token");
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const otp = generateOTP();
  const otpToken = createToken(
    { otp },
    process.env.OTP_SECRET,
    process.env.OTP_EXPIRE
  );

  user.password_reset_token = otpToken;
  await user.save();

  await sendEmail(user.email, "Reset Password", `Your OTP is ${otp}`);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset email sent",
    data: null,
  });
});

export const adminSetTemporaryPassword = catchAsync(async (req, res) => {
  const { password } = req.body;
  if (!password) {
    throw new AppError(httpStatus.BAD_REQUEST, "Password is required");
  }

  const user = await User.findById(req.params.id).select("+password");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  user.password = password;
  await user.save();

  const sanitizedUser = await User.findById(req.params.id).select(safeUserSelect);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Temporary password set",
    data: sanitizedUser,
  });
});

export const updateProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const editableFields = [
    "firstName",
    "lastName",
    "name",
    "username",
    "phone",
    "bio",
    "gender",
    "selfDescription",
    "dob",
    "height",
    "sexualOrientation",
    "personalityType",
    "religion",
    "lookingFor",
    "interests",
    "location",
    "language",
    "country",
    "notifications",
    "addresses",
  ];

  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      let value = req.body[field];

      if (["lookingFor", "interests", "addresses"].includes(field)) {
        value = parseIfJson(value, field);
      }

      if (field === "notifications") {
        value =
          typeof value === "string"
            ? value.toLowerCase() === "true"
            : Boolean(value);
      }

      if (field === "dob" && value) {
        const parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
          throw new AppError(httpStatus.BAD_REQUEST, "Invalid date for dob");
        }
        value = parsedDate;
      }

      user[field] = value;
    }
  });

  if (req.file) {
    const upload = await uploadOnCloudinary(req.file.buffer);
    user.avatar = { public_id: upload.public_id, url: upload.secure_url };
  }

  await user.save();

  const updatedUser = await User.findById(req.user._id).select(safeUserSelect);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile updated successfully",
    data: updatedUser,
  });
});

export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (newPassword !== confirmPassword)
    throw new AppError(httpStatus.BAD_REQUEST, "Passwords don't match");

  const user = await User.findById(req.user._id).select("+password");

  if (!(await User.isPasswordMatched(currentPassword, user.password))) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Current password wrong");
  }
  user.password = newPassword;

  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed",
  });
});
