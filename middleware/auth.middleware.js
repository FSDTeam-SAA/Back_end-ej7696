import jwt from "jsonwebtoken";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { User } from "./../model/user.model.js";

const normalizeExpiredProfessionalSubscription = async (user) => {
  if (!user) return user;
  const isProfessional =
    user.subscriptionTier?.toString().toLowerCase() === "professional";
  if (!isProfessional) return user;

  const now = new Date();
  const expiresAt = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;

  if (expiresAt && expiresAt.getTime() > now.getTime()) {
    return user;
  }

  user.subscriptionTier = "starter";
  user.subscriptionStartedAt = null;
  user.subscriptionExpiresAt = null;
  await user.save();
  return user;
};

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new AppError(httpStatus.NOT_FOUND, "Token not found");

  try {
    const decoded = await jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const user = await User.findById(decoded._id);
    if (user && (await User.isOTPVerified(user._id))) {
      if (user.status !== "active") {
        throw new AppError(httpStatus.FORBIDDEN, "Account is inactive");
      }
      if (
        !decoded.sid ||
        !user.activeSessionId ||
        decoded.sid !== user.activeSessionId
      ) {
        throw new AppError(401, "Session expired. Please login again.");
      }
      req.user = user;
    } else {
      throw new AppError(401, "Invalid token");
    }
    next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, "Invalid token");
  }
};

export const optionalProtect = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return next();

  try {
    const decoded = await jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    let user = await User.findById(decoded._id);
    if (user && (await User.isOTPVerified(user._id))) {
      if (user.status !== "active") {
        throw new AppError(httpStatus.FORBIDDEN, "Account is inactive");
      }
      if (
        !decoded.sid ||
        !user.activeSessionId ||
        decoded.sid !== user.activeSessionId
      ) {
        throw new AppError(401, "Session expired. Please login again.");
      }
      req.user = user;
    } else {
      throw new AppError(401, "Invalid token");
    }
    return next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, "Invalid token");
  }
};

export const isAdmin = (req, res, next) => {
  const role = req.user?.role?.toString().toLowerCase();
  if (role !== "admin") {
    throw new AppError(403, "Access denied. You are not an admin.");
  }
  next();
};

export const isUser = (req, res, next) => {
  const role = req.user?.role?.toString().toLowerCase();
  if (role !== "user") {
    throw new AppError(403, "Access denied. You are not an user.");
  }
  next();
};

export const requirePermission = (permission) => (req, res, next) => {
  const role = req.user?.role?.toString().toLowerCase();
  if (role === "admin") return next();
  if (role !== "sub-admin") {
    throw new AppError(403, "Access denied. Permission required.");
  }
  const permissions = Array.isArray(req.user?.subAdminPermissions)
    ? req.user.subAdminPermissions
    : [];
  if (!permissions.includes(permission)) {
    throw new AppError(403, "Access denied. Permission required.");
  }
  next();
};

export const requireAnyPermission = (permissions = []) => (req, res, next) => {
  const role = req.user?.role?.toString().toLowerCase();
  if (role === "admin") return next();
  if (role !== "sub-admin") {
    throw new AppError(403, "Access denied. Permission required.");
  }
  const current = Array.isArray(req.user?.subAdminPermissions)
    ? req.user.subAdminPermissions
    : [];
  if (!permissions.some((p) => current.includes(p))) {
    throw new AppError(403, "Access denied. Permission required.");
  }
  next();
};
