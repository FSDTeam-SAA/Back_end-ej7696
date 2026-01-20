import httpStatus from "http-status";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

const safeUserSelect =
  "-password -refreshToken -verificationInfo -password_reset_token";

const parseStatus = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = value.toString().toLowerCase();
  if (!["active", "inactive"].includes(normalized)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Status must be active or inactive");
  }
  return normalized;
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

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(safeUserSelect)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users fetched",
    data: {
      users,
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
  const user = await User.findById(req.params.id).select(safeUserSelect);

  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User details fetched",
    data: user,
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
