import AppError from "../errors/AppError.js";
import { createToken, verifyToken } from "../utils/authToken.js";
import catchAsync from "../utils/catchAsync.js";
import { generateOTP } from "../utils/commonMethod.js";
import httpStatus from "http-status";
import sendResponse from "../utils/sendResponse.js";
import { sendEmail } from "../utils/sendEmail.js";
import { User } from "./../model/user.model.js";
import {
  createReferralRelationshipOnSignup,
  generateUniqueReferralCode,
  normalizeReferralCode,
  validateReferralAtSignup,
} from "../utils/referral.service.js";

const createSessionId = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

const INSTALLATION_HEADER_KEY = "x-app-installation-id";
const FALLBACK_INSTALLATION_HEADER_KEY = "x-installation-id";
const normalizeInstallationId = (installationId) =>
  installationId?.toString().trim() || "";

const resolveInstallationId = (req) => {
  const headerInstallationId =
    req.get(INSTALLATION_HEADER_KEY) ?? req.get(FALLBACK_INSTALLATION_HEADER_KEY);
  const bodyInstallationId = req.body?.installationId;
  return normalizeInstallationId(headerInstallationId || bodyInstallationId);
};

const getStoredInstallationId = (user) =>
  normalizeInstallationId(user?.activeInstallationId || user?.activeDeviceId);

const setStoredInstallationId = (user, installationId) => {
  user.activeDeviceId = installationId;
  user.activeInstallationId = installationId;
};

const isInstallationLockBypassRole = (user) =>
  user?.role?.toString().toLowerCase() === "admin";

const buildJwtPayload = (user, sessionId, installationId) => ({
  _id: user._id,
  email: user.email,
  role: user.role,
  sid: sessionId,
  iid: installationId,
});

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

export const register = catchAsync(async (req, res) => {
  const { phone, name, email, password, confirmPassword } = req.body;

  if (!email || !password) {
    throw new AppError(httpStatus.FORBIDDEN, "Please fill in all fields");
  }

  if (password !== confirmPassword) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Password and confirm password do not match"
    );
  }
  const checkUser = await User.findOne({ email: email });
  if (checkUser)
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Email already exists, please try another email"
    );

  const installationId = resolveInstallationId(req);
  if (!installationId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Installation identifier is required");
  }

  const referralCodeInput = normalizeReferralCode(
    req.body?.referralCode ?? req.body?.referredByCode ?? req.query?.ref
  );
  let referrer = null;

  if (referralCodeInput) {
    referrer = await User.findOne({ referralCode: referralCodeInput }).select(
      "_id email referralCode activeInstallationId"
    );
    validateReferralAtSignup({
      referrer,
      email,
      installationId,
    });
  }

  const generatedReferralCode = await generateUniqueReferralCode();

  const user = await User.create({
    phone,
    name,
    email,
    password,
    referralCode: generatedReferralCode,
    referredBy: referrer?._id || null,
    referredByCode: referrer?.referralCode || "",
    referredAt: referrer ? new Date() : null,
    role: "user",
    verificationInfo: { token: "", verified: true },
  });

  const sessionId = createSessionId();
  const jwtPayload = buildJwtPayload(user, sessionId, installationId);
  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN
  );

  const refreshToken = createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN
  );
  user.refreshToken = refreshToken;
  user.activeSessionId = sessionId;
  setStoredInstallationId(user, installationId);
  await user.save();

  if (referrer) {
    await createReferralRelationshipOnSignup({
      referrer,
      referredUser: user,
      referralCode: referrer.referralCode,
    });
  }

  user.accessToken = accessToken;

  const userObj = user.toObject();
  userObj.accessToken = accessToken;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User registered successfully",
    data: userObj,
  });
});

export const updateUserRole = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (req.body?.role === undefined) {
    throw new AppError(httpStatus.BAD_REQUEST, "Role is required");
  }

  user.role = parseRole(req.body.role);
  if (user.role !== "sub-admin") {
    user.subAdminPermissions = [];
  }
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User role updated successfully",
    data: user,
  });
});

export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  if (
    user?.password &&
    !(await User.isPasswordMatched(password, user.password))
  ) {
    throw new AppError(httpStatus.FORBIDDEN, "Password is not correct");
  }
  if (user.status !== "active") {
    throw new AppError(httpStatus.FORBIDDEN, "Account is inactive");
  }
  const installationId = resolveInstallationId(req);
  if (!installationId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Installation identifier is required");
  }

  // Admins can rotate their active installation by logging in again.
  const activeInstallationId = getStoredInstallationId(user);
  if (
    !isInstallationLockBypassRole(user) &&
    activeInstallationId &&
    activeInstallationId !== installationId
  ) {
    return sendResponse(res, {
      statusCode: httpStatus.CONFLICT,
      success: false,
      message: "This account is already locked to another installation",
      data: {
        activeInstallationId,
        adminResetRequired: true,
      },
    });
  }
  if (!(await User.isOTPVerified(user._id))) {
    const otp = generateOTP();
    const jwtPayloadOTP = {
      otp: otp,
    };

    const otptoken = createToken(
      jwtPayloadOTP,
      process.env.OTP_SECRET,
      process.env.OTP_EXPIRE
    );
    user.verificationInfo.token = otptoken;
    await user.save();
    await sendEmail(user.email, "Registerd Account", `Your OTP is ${otp}`);

    return sendResponse(res, {
      statusCode: httpStatus.FORBIDDEN,
      success: false,
      message: "OTP is not verified, please verify your OTP",
      data: { email: user.email },
    });
  }
  const sessionId = createSessionId();
  const jwtPayload = buildJwtPayload(user, sessionId, installationId);
  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN
  );

  const refreshToken = createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN
  );

  user.refreshToken = refreshToken;
  user.activeSessionId = sessionId;
  setStoredInstallationId(user, installationId);
  await user.save();

  res.cookie("refreshToken", refreshToken, {
    secure: true,
    httpOnly: true,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  const userObj = user.toObject();
  delete userObj.password;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User Logged in successfully",
    data: {
      accessToken,
      refreshToken: refreshToken,
      role: user.role,
      _id: user._id,
      mustChangePassword: Boolean(user.mustChangePassword),
      user: userObj,
    },
  });
});

export const forgetPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const otp = generateOTP();
  const otpPayload = { otp };
  const otpToken = createToken(
    otpPayload,
    process.env.OTP_SECRET,
    process.env.OTP_EXPIRE
  );

  user.password_reset_token = otpToken;
  await user.save();

  await sendEmail(user.email, "Reset Password", `Your OTP is ${otp}`);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP sent to your email successfully",
    data: null,
  });
});

export const resetPassword = catchAsync(async (req, res) => {
  const { email, otp, password } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (!user.password_reset_token) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Password reset token is invalid or expired"
    );
  }

  let decoded;
  try {
    decoded = verifyToken(user.password_reset_token, process.env.OTP_SECRET);
  } catch (err) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP expired or invalid");
  }

  if (decoded.otp !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }

  user.password = password;
  user.password_reset_token = undefined;
  user.mustChangePassword = false;
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset successfully",
    data: null,
  });
});

export const verifyEmail = catchAsync(async (req, res) => {
  const { email, otp } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (!otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP is required");
  }

  if (!user.password_reset_token) {
    throw new AppError(httpStatus.BAD_REQUEST, "Verification token missing");
  }

  let decoded;
  try {
    decoded = verifyToken(user.password_reset_token, process.env.OTP_SECRET);
  } catch (err) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP expired or invalid");
  }

  if (decoded.otp !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }

  user.isVerified = true;
  user.verificationInfo.token = "";
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Email verified successfully",
    data: null,
  });
});

export const changePassword = catchAsync(async (req, res) => {
  const oldPassword = req.body?.oldPassword ?? req.body?.currentPassword;
  const newPassword = req.body?.newPassword;
  const confirmPassword = req.body?.confirmPassword;

  if (!oldPassword || !newPassword) {
    throw new AppError(httpStatus.BAD_REQUEST, "Old password and new password are required");
  }
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    throw new AppError(httpStatus.BAD_REQUEST, "Passwords don't match");
  }
  if (oldPassword === newPassword) {
    throw new AppError(httpStatus.BAD_REQUEST, "Old password and new password cannot be same");
  }

  const user = await User.findById(req.user?._id).select("+password"); // ✅ include password

  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const matched = await User.isPasswordMatched(oldPassword, user.password);
  if (!matched) throw new AppError(httpStatus.UNAUTHORIZED, "Current password wrong");

  user.password = newPassword;
  user.mustChangePassword = false;
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed",
    data: "",
  });
});


export const refreshToken = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError(400, "Refresh token is required");
  }
  const installationId = resolveInstallationId(req);
  if (!installationId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Installation identifier is required");
  }

  const decoded = verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET);
  const user = await User.findById(decoded._id);
  if (!user || user.refreshToken !== refreshToken) {
    throw new AppError(401, "Invalid refresh token");
  }
  if (!decoded.sid || !user.activeSessionId || decoded.sid !== user.activeSessionId) {
    throw new AppError(401, "Session expired. Please login again.");
  }
  if (!decoded.iid || decoded.iid !== installationId) {
    throw new AppError(401, "Session expired. Please login again.");
  }
  const activeInstallationId = getStoredInstallationId(user);
  if (!activeInstallationId || activeInstallationId !== installationId) {
    throw new AppError(401, "Session expired. Please login again.");
  }
  if (user.status !== "active") {
    throw new AppError(httpStatus.FORBIDDEN, "Account is inactive");
  }
  const jwtPayload = buildJwtPayload(user, user.activeSessionId, installationId);

  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Token refreshed successfully",
    data: { accessToken, refreshToken },
  });
});

export const logout = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  await User.findByIdAndUpdate(
    userId,
    {
      refreshToken: "",
      activeSessionId: "",
      activeDeviceId: "",
      activeInstallationId: "",
    },
    { new: true }
  );
  res.clearCookie("refreshToken", {
    secure: true,
    httpOnly: true,
    sameSite: "none",
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged out successfully",
    data: "",
  });
});
