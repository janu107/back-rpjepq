const jwt = require("jsonwebtoken");

const logger = require("../config/logger");
const authService = require("../services/auth.service");

const rechazar = (res, message) => res.status(401).json({ ok: false, message });

// Además de validar el token, se confirma contra la base (con caché corta) que el
// usuario sigue ACTIVO, que su contraseña no cambió y cuáles son sus roles ACTUALES.
// Así desactivar a alguien o quitarle un rol no espera a que venza el token (8 h).
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Acceso protegido sin token", {
      method: req.method,
      url: req.originalUrl
    });

    return rechazar(res, "Token no proporcionado");
  }

  const token = authHeader.split(" ")[1];
  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    logger.warn("Token invalido o expirado", {
      method: req.method,
      url: req.originalUrl,
      tokenPrefix: token.slice(0, 8)
    });

    return rechazar(res, "Token invalido o expirado");
  }

  try {
    const sesion = await authService.getSessionUser(decoded.id);

    if (!sesion || sesion.estado !== "ACTIVO") {
      logger.warn("Sesion rechazada: usuario inactivo o inexistente", { id: decoded.id, usuario: decoded.usuario });
      return rechazar(res, "Usuario inactivo o inexistente");
    }

    // Tokens emitidos antes de este cambio no traen huella: se pide iniciar sesión de nuevo.
    if (!decoded.pv || decoded.pv !== sesion.huella) {
      logger.warn("Sesion rechazada: la contrasena cambio o el token es anterior", { id: decoded.id, usuario: decoded.usuario });
      return rechazar(res, "La sesion ya no es valida. Inicie sesion de nuevo");
    }

    req.user = { id: sesion.id, usuario: sesion.usuario, rol: sesion.rol, roles: sesion.roles };
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = authMiddleware;
