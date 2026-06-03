const sendResponse = (res, data) => {
  res.status(data?.statusCode).json({
    success: data.success,
    ...(data.code ? { code: data.code } : {}),
    message: data.message,
    data: data.data,
  });
};

export default sendResponse;
