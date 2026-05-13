const logger = require("../config/logger");

const notFoundHandler = (req, res, next) => {
  const error = new Error(`Ruta no encontrada: ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;

  logger.error("Error capturado por middleware global", {
    status,
    message: err.message,
    method: req.method,
    url: req.originalUrl,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined
  });

  res.status(status).json({
    ok: false,
    message: err.message || "Error interno del servidor",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined
  });
};

module.exports = {
  notFoundHandler,
  errorHandler
};
