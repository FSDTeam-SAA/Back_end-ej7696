const addMonths = (date, months) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

export const buildExamUnlockSummary = ({
  access,
  examMap,
  user,
  expiryMonths = 3,
  now = Date.now(),
}) => {
  const unlockDate = access?.purchasedAt || null;
  const isLifetime = access?.accessDuration === "lifetime";
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
    purchaseType: access.purchaseType || null,
    paymentStatus: access.paymentStatus || null,
    unlockDate,
    purchasedAt: unlockDate,
    expiresAt,
    expiryMonths: isLifetime ? null : expiryMonths,
    accessDuration: access?.accessDuration || "three_months",
    isLifetime,
    isExpired,
  };
};
