const handleValidationError = (err) => {
  const errorSources = Object.values(err.errors).map((val) => {
    return {
      path: val?.path,
      message: val?.message,
    };
  });

  const statusCode = 400;

  return {
    statusCode,
    message: errorSources[0]?.message || "Validation Error",
    errorSources,
  };
};

export default handleValidationError;
