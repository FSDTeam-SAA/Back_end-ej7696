import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new Schema(
  {
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    name: { type: String },
    email: {
      type: String,
      trim: true,
    },
    password: { type: String, select: false },
    username: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    bio: { type: String, maxlength: 500 },
    gender: {
      type: String,
      enum: [
        "male",
        "female",
        "non-binary",
        "trans man",
        "trans woman",
        "other",
        "prefer not to say",
      ],
    },
    selfDescription: { type: String, maxlength: 1000 },
    dob: {
      type: Date,
    },
    height: {
      type: String,
    },
    sexualOrientation: {
      type: String,
      enum: ["man", "woman", "prefer not to say"],
    },
    personalityType: {
      type: String,
      enum: [
        "INTJ",
        "INTP",
        "INFJ",
        "INFP",
        "ISTJ",
        "ISTP",
        "ISFJ",
        "ISFP",
        "ENTJ",
        "ENTP",
        "ENFJ",
        "ENFP",
        "ESTJ",
        "ESTP",
        "ESFJ",
        "ESFP",
      ],
    },
    religion: {
      type: String,
      enum: [
        "agnostic",
        "atheist",
        "buddhist",
        "catholic",
        "christian",
        "hindu",
        "jewish",
        "muslim",
        "spiritual",
        "prefer not to say",
      ],
    },
    lookingFor: [
      {
        type: String,
        enum: [
          "something casual",
          "friends",
          "friends with benefits",
          "one night stand",
          "long term dating",
          "short term dating",
          "i don't know yet",
          "vibe",
        ],
      },
    ],
    interests: [
      {
        type: String,
        maxlength: 100,
      },
    ],
    avatar: {
      public_id: { type: String, default: "" },
      url: { type: String, default: "" },
    },
    profilePhotos: [
      {
        public_id: { type: String, required: true },
        url: { type: String, required: true },
      },
    ],
    location: { type: String },
    addresses: {
      type: Array,
      default: [],
    },
    notifications: {
      type: Boolean,
      default: true,
    },
    language: {
      type: String,
      default: "en",
    },
    country: {
      type: String,
      default: "Kuwait",
    },
    referralCode: {
      type: String,
      default: () => Math.random().toString(36).substr(2, 9).toUpperCase(),
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    role: {
      type: String,
      enum: ["user", "admin", "sub-admin", "storeman"],
      default: "user",
    },
    subAdminPermissions: {
      type: [String],
      default: [],
    },
    subscriptionTier: {
      type: String,
      enum: ["starter", "professional"],
      default: "starter",
    },
    verificationInfo: {
      verified: { type: Boolean, default: false },
      token: { type: String, default: "" },
    },
    password_reset_token: { type: String, default: "" },
    fine: { type: Number, default: 0 },
    refreshToken: { type: String, default: "" },
    activeSessionId: { type: String, default: "" },
    activeDeviceId: { type: String, default: "" },
    review: [
      {
        rating: {
          type: Number,
          min: [0, "Rating cannot be negative"],
          max: [5, "Rating cannot exceed 5"],
          default: 0,
        },
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        text: {
          type: String,
        },
      },
    ],
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    const saltRounds = Number(process.env.bcrypt_salt_round) || 10;
    this.password = await bcrypt.hash(this.password, saltRounds);
  }
  if (this.isModified("addresses")) {
    let defaultFound = false;

    this.addresses = this.addresses.map((addr) => {
      if (addr.isDefault) {
        if (!defaultFound) {
          defaultFound = true;
          return addr;
        }
        addr.isDefault = false;
      }
      return addr;
    });
  }
  next();
});

userSchema.statics.isUserExistsByEmail = async function (email) {
  return await this.findOne({ email }).select("+password");
};

userSchema.statics.isOTPVerified = async function (id) {
  const user = await this.findById(id).select("+verificationInfo");
  return user?.verificationInfo.verified;
};

userSchema.statics.isPasswordMatched = async function (
  plainTextPassword,
  hashPassword
) {
  return await bcrypt.compare(plainTextPassword, hashPassword);
};

userSchema.statics.findByPhone = async function (phone) {
  return await this.findOne({ phone });
};

export const User = mongoose.model("User", userSchema);
