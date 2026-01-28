import jwt from "jsonwebtoken";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { User } from "./../model/user.model.js";

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new AppError(httpStatus.NOT_FOUND, "Token not found");

  try {
    const decoded = await jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    // console.log(decoded)
    const user = await User.findById(decoded._id);
    if (user && (await User.isOTPVerified(user._id))) {
      if (user.status !== "active") {
        throw new AppError(httpStatus.FORBIDDEN, "Account is inactive");
      }
      req.user = user;
    }
    next();
  } catch (err) {
    throw new AppError(401, "Invalid token");
  }
};

export const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    throw new AppError(403, "Access denied. You are not an admin.");
  }
  next();
};

export const isUser = (req, res, next) => {
  if (req.user?.role !== "user") {
    throw new AppError(403, "Access denied. You are not an user.");
  }
  next();
};

export const requirePermission = (permission) => (req, res, next) => {
  if (req.user?.role === "admin") return next();
  if (req.user?.role !== "sub-admin") {
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
  if (req.user?.role === "admin") return next();
  if (req.user?.role !== "sub-admin") {
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
