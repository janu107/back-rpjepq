const logger = require("../config/logger");

const notFoundHandler = (req, res, next) => {
  const error = new Error(`Ruta no encontrada: ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

const errorHandler = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || "Error interno del servidor";

  // No exponer errores SQL crudos al usuario (requisito Version VII).
  // Sólo se traduce cuando NO hay un status de negocio explícito (err.status)
  // y el error tiene firma de la base de datos (code ER_* o sqlMessage).
  const isDbError = !err.status && (err.sqlMessage || (typeof err.code === "string" && err.code.startsWith("ER_")));
  if (isDbError) {
    switch (err.code) {
      case "ER_DUP_ENTRY":
        status = 409; message = "El registro ya existe (duplicado)."; break;
      case "ER_ROW_IS_REFERENCED":
      case "ER_ROW_IS_REFERENCED_2":
        status = 409; message = "No se puede eliminar: el registro está siendo utilizado."; break;
      case "ER_NO_REFERENCED_ROW":
      case "ER_NO_REFERENCED_ROW_2":
        status = 400; message = "Dato relacionado inválido."; break;
      default:
        status = 500; message = "No se pudo completar la operación en la base de datos.";
    }
  }

  const isProduction = process.env.NODE_ENV === "production";
  const publicMessage = status >= 500 && isProduction ? "Error interno del servidor" : message;

  logger.error("Error capturado por middleware global", {
    status,
    message: err.message,
    code: err.code,
    sqlMessage: err.sqlMessage,
    method: req.method,
    url: req.originalUrl,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined
  });

  res.status(status).json({
    ok: false,
    message: publicMessage,
    error: !isProduction && status < 500 ? message : undefined
  });
};

module.exports = {
  notFoundHandler,
  errorHandler
};
