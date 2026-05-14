const logger = require("../config/logger");

const notFoundHandler = (req, res, next) => {
  const error = new Error(`Ruta no encontrada: ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const isProduction = process.env.NODE_ENV === "production";
  const publicMessage = status >= 500 && isProduction ? "Error interno del servidor" : err.message || "Error interno del servidor";

  logger.error("Error capturado por middleware global", {
    status,
    message: err.message,
    method: req.method,
    url: req.originalUrl,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined
  });

  res.status(status).json({
    ok: false,
    message: publicMessage,
    error: !isProduction && status < 500 ? err.message : undefined
  });
};

module.exports = {
  notFoundHandler,
  errorHandler
};
