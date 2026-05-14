const logger = require("../config/logger");
const { auditFromRequest } = require("./audit.middleware");

const authorizeRoles = (...rolesPermitidos) => (req, res, next) => {
  const rol = String(req.user?.rol || "").toUpperCase();
  const allowed = rolesPermitidos.map((role) => String(role).toUpperCase());

  if (allowed.includes(rol)) {
    return next();
  }

  logger.warn("Accion denegada por permisos", {
    usuario: req.user?.usuario,
    rol: req.user?.rol,
    method: req.method,
    url: req.originalUrl
  });

  auditFromRequest(req, {
    modulo: "SEGURIDAD",
    accion: "ACCESO_DENEGADO",
    descripcion: `Rol ${req.user?.rol || "SIN_ROL"} no autorizado. Permitidos: ${allowed.join(", ")}`
  });

  return res.status(403).json({
    ok: false,
    message: "No tiene permisos para realizar esta accion"
  });
};

module.exports = { authorizeRoles };
