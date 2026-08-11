const addMonths = (date, months) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

export const isActiveProfessionalSubscription = (
  user,
  referenceDate = new Date()
) => {
  if (
    user?.subscriptionTier?.toString().trim().toLowerCase() !== "professional"
  ) {
    return false;
  }

  const expiresAt = user?.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;
  return Boolean(
    expiresAt &&
      !Number.isNaN(expiresAt.getTime()) &&
      expiresAt.getTime() > new Date(referenceDate).getTime()
  );
};

// ExamAccess.status records durable ownership. Actual access is deliberately
// gated by the user's subscription so owned exams become available again after
// a later resubscription without charging for the exam a second time.
export const isExamOwned = (access) => access?.status === "unlocked";

export const canAccessOwnedExam = ({
  user,
  access,
  referenceDate = new Date(),
} = {}) =>
  isExamOwned(access) && isActiveProfessionalSubscription(user, referenceDate);

export const buildSelectedExamUnlockResponse = ({ exam, access } = {}) => {
  if (!exam || !access) return null;

  return {
    examId: exam._id,
    examName: exam.name || null,
    unlocked: isExamOwned(access),
    accessId: access._id,
    purchaseType: access.purchaseType,
    paymentStatus: access.paymentStatus,
    accessDuration: access.accessDuration,
    expiresAt: access.expiresAt,
  };
};

export const buildExamUnlockSummary = ({
  access,
  examMap,
  examImageMap = {},
  user,
  expiryMonths = 3,
  now = Date.now(),
  unlocked = isActiveProfessionalSubscription(user, new Date(now)),
}) => {
  const owned = isExamOwned(access);
  const hasAccess = owned && Boolean(unlocked);
  const unlockDate = access?.purchasedAt || null;
  const isLifetime =
    access?.accessDuration === "lifetime" || access?.purchaseType !== "plan";
  const fallbackExpiresAt = unlockDate
    ? addMonths(unlockDate, expiryMonths)
    : null;
  const expiresAt = isLifetime
    ? null
    : access?.expiresAt ||
      (access?.purchaseType === "plan"
        ? user?.subscriptionExpiresAt || fallbackExpiresAt
        : fallbackExpiresAt);
  const isExpired = !isLifetime && expiresAt
    ? new Date(expiresAt).getTime() <= now
    : false;

  return {
    examId: access.examId,
    examName: examMap[access.examId?.toString()] || null,
    examImageUrl: examImageMap[access.examId?.toString()] || null,
    purchaseType: access.purchaseType || null,
    paymentStatus: access.paymentStatus || null,
    unlockDate,
    purchasedAt: unlockDate,
    expiresAt,
    expiryMonths: isLifetime ? null : expiryMonths,
    accessDuration: access?.accessDuration || "three_months",
    isLifetime,
    isExpired,
    owned,
    unlocked: hasAccess,
    requiresSubscription: owned && !hasAccess,
  };
};
