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
