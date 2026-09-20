// Exam unlocks are sold as one-month subscriptions as of Sep 2026. Only
// purchases made before the store migration keep the six-month window.
export const EXAM_ACCESS_DURATION_MONTHS = 1;
export const EXAM_ACCESS_DURATION_LABEL = "one_month";
export const LEGACY_EXAM_ACCESS_DURATION_MONTHS = 6;

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
export const isExamOwned = (access) =>
  ["active", "expired", "revoked", "unlocked"].includes(access?.status);

export const isExamEntitlementActive = (
  access,
  referenceDate = new Date()
) => {
  if (!access || !["active", "unlocked"].includes(access.status)) return false;
  const expiresAt = access.expiresAt ? new Date(access.expiresAt) : null;
  return Boolean(
    expiresAt &&
      !Number.isNaN(expiresAt.getTime()) &&
      expiresAt.getTime() > new Date(referenceDate).getTime()
  );
};

export const canAccessOwnedExam = ({
  access,
  referenceDate = new Date(),
} = {}) => isExamEntitlementActive(access, referenceDate);

export const buildSelectedExamUnlockResponse = ({ exam, access } = {}) => {
  if (!exam || !access) return null;

  return {
    examId: exam._id,
    examName: exam.name || null,
    unlocked: isExamEntitlementActive(access),
    accessId: access._id,
    purchaseType: access.purchaseType,
    paymentStatus: access.paymentStatus,
    accessDuration: access.accessDuration,
    startedAt: access.startedAt || access.purchasedAt,
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
  unlocked = isExamEntitlementActive(access, new Date(now)),
}) => {
  const owned = ["active", "expired", "revoked", "unlocked"].includes(
    access?.status
  );
  const hasAccess = owned && Boolean(unlocked);
  const unlockDate = access?.startedAt || access?.purchasedAt || null;
  const isLifetime = false;
  const fallbackExpiresAt = unlockDate
    ? addMonths(unlockDate, EXAM_ACCESS_DURATION_MONTHS)
    : null;
  const expiresAt = access?.expiresAt || fallbackExpiresAt;
  const isExpired = expiresAt
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
    startedAt: unlockDate,
    expiryMonths: EXAM_ACCESS_DURATION_MONTHS,
    accessDuration: access?.accessDuration || EXAM_ACCESS_DURATION_LABEL,
    accessStatus: hasAccess ? "active" : isExpired ? "expired" : access?.status,
    source: access?.source || "legacy",
    canPurchase: !hasAccess,
    currentPrice: 150,
    isLifetime,
    isExpired,
    owned,
    unlocked: hasAccess,
    requiresSubscription: false,
  };
};
