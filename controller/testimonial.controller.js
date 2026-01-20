import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import { Testimonial } from "../model/testimonial.model.js";

const parseRating = (value) => {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Rating must be a number");
  }
  if (parsed < 1 || parsed > 5) {
    throw new AppError(httpStatus.BAD_REQUEST, "Rating must be between 1 and 5");
  }
  return parsed;
};

const sanitizeTestimonial = (doc) => {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  return obj;
};

export const createTestimonial = catchAsync(async (req, res) => {
  const { name, testimonial } = req.body;
  const rating = parseRating(req.body.rating);

  if (!name || !testimonial || rating === undefined) {
    throw new AppError(httpStatus.BAD_REQUEST, "Name, testimonial, and rating are required");
  }

  let image = { public_id: "", url: "" };
  if (req.file) {
    const upload = await uploadOnCloudinary(req.file.buffer);
    image = { public_id: upload.public_id, url: upload.secure_url };
  }

  const newTestimonial = await Testimonial.create({
    name,
    testimonial,
    rating,
    image,
    createdBy: req.user?._id || null,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Testimonial created successfully",
    data: sanitizeTestimonial(newTestimonial),
  });
}); 

export const getTestimonials = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const [testimonials, total] = await Promise.all([
    Testimonial.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Testimonial.countDocuments(),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Testimonials fetched",
    data: {
      testimonials: testimonials.map(sanitizeTestimonial),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    },
  });
});

export const updateTestimonial = catchAsync(async (req, res) => {
  const testimonial = await Testimonial.findById(req.params.id);
  if (!testimonial) throw new AppError(httpStatus.NOT_FOUND, "Testimonial not found");

  const isOwner =
    testimonial.createdBy &&
    req.user?._id &&
    testimonial.createdBy.toString() === req.user._id.toString();

  if (!isOwner && req.user?.role !== "admin") {
    throw new AppError(httpStatus.FORBIDDEN, "Not authorized to update this testimonial");
  }

  const allowedFields = ["name", "testimonial"];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      testimonial[field] = req.body[field];
    }
  });

  if (req.body.rating !== undefined) {
    testimonial.rating = parseRating(req.body.rating);
  }

  if (req.file) {
    const upload = await uploadOnCloudinary(req.file.buffer);
    testimonial.image = { public_id: upload.public_id, url: upload.secure_url };
  }

  await testimonial.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Testimonial updated successfully",
    data: sanitizeTestimonial(testimonial),
  });
});

export const deleteTestimonial = catchAsync(async (req, res) => {
  const testimonial = await Testimonial.findById(req.params.id);
  if (!testimonial) throw new AppError(httpStatus.NOT_FOUND, "Testimonial not found");

  const isOwner =
    testimonial.createdBy &&
    req.user?._id &&
    testimonial.createdBy.toString() === req.user._id.toString();

  if (!isOwner && req.user?.role !== "admin") {
    throw new AppError(httpStatus.FORBIDDEN, "Not authorized to delete this testimonial");
  }

  await testimonial.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Testimonial deleted successfully",
    data: null,
  });
});
