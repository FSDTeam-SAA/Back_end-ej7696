const handleDuplicateError = (err) => {
  const keyPattern = err?.keyPattern || {};
  const keyValue = err?.keyValue || {};
  const field =
    Object.keys(keyPattern)[0] || Object.keys(keyValue)[0] || "record";
  const duplicateValue = keyValue[field];
  const fieldLabel = field
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .trim();
  const normalizedLabel =
    fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1);
  const duplicateMessage =
    duplicateValue === undefined || duplicateValue === null || duplicateValue === ""
      ? `${normalizedLabel} already exists`
      : `${normalizedLabel} "${duplicateValue}" already exists`;

  const errorSources = [
    {
      path: field,
      message: duplicateMessage,
    },
  ];

  const statusCode = 400;

  return {
    statusCode,
    message: duplicateMessage,
    errorSources,
  };
};

export default handleDuplicateError;
