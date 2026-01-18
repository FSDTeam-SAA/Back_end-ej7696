// const httpStatus = require("http-status");

const notFound = (req, res, next) => {
  return res.status(400).json({
    success: false,
    message: "API Not Found !!",
    error: "",
  });
};

export default notFound;
