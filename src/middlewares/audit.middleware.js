const auditoriaService = require("../services/auditoria.service");

const getIp = (req) => req.headers["x-forwarded-for"]?.split(",")[0] || req.ip || req.socket?.remoteAddress || null;

const auditFromRequest = (req, { modulo, accion, descripcion }) => auditoriaService.registrar({
  usuarioId: req.user?.id || null,
  usuario: req.user?.usuario || req.body?.usuario || null,
  rol: req.user?.rol || null,
  modulo,
  accion,
  metodo: req.method,
  ruta: req.originalUrl,
  descripcion,
  ip: getIp(req),
  userAgent: req.headers["user-agent"] || null
});

const auditAction = (modulo, accion, getDescription) => (req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      const descripcion = typeof getDescription === "function" ? getDescription(req, res) : getDescription;
      auditFromRequest(req, { modulo, accion, descripcion });
    }
  });
  next();
};

module.exports = { auditAction, auditFromRequest };
