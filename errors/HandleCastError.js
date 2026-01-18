const HandleCastError = (err) => {
  const errorSources = [
    {
      path: err.path,
      message: err.message,
    },
  ];

  let statusCode = 400;
  return {
    statusCode,
    message: "Invalid ID",
    errorSources,
  };
};

export default HandleCastError;
