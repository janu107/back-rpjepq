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
      // SIGNAL SQLSTATE '45000' dentro de un procedimiento NO es una falla del
      // servidor: es una regla de negocio que nosotros mismos escribimos (ej.
      // "Solo se pueden revertir planillas GENERADAS"). Antes caía en el caso
      // genérico y el usuario veía un error de servidor en vez del motivo real,
      // que además quedaba sólo en el log. El texto del MESSAGE_TEXT es nuestro,
      // no SQL crudo, así que se puede mostrar tal cual.
      case "ER_SIGNAL_EXCEPTION":
        status = 409; message = err.sqlMessage || err.message || "La operación no es válida en el estado actual."; break;
      default:
        status = 500; message = "No se pudo completar la operación en la base de datos.";
    }
  }

  const isProduction = process.env.NODE_ENV === "production";
  const publicMessage = status >= 500 && isProduction ? "Error interno del servidor" : message;

  // Los errores del cliente (4xx: 404 ruta inexistente, 401 token, 409 duplicado,
  // 400 validacion) son normales -> se registran como WARN y sin stack trace.
  // Solo los errores reales del servidor (5xx) se registran como ERROR con stack.
  const isServerError = status >= 500;
  const logFn = isServerError ? logger.error : logger.warn;
  logFn("Solicitud con error", {
    status,
    message: err.message,
    code: err.code,
    sqlMessage: err.sqlMessage,
    method: req.method,
    url: req.originalUrl,
    stack: isServerError && process.env.NODE_ENV === "development" ? err.stack : undefined
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
