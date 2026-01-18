const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      return next(error);
    });
  };
};

export default catchAsync;
