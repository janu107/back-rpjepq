const jwt = require("jsonwebtoken");

const logger = require("../config/logger");

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Acceso protegido sin token", {
      method: req.method,
      url: req.originalUrl
    });

    return res.status(401).json({
      ok: false,
      message: "Token no proporcionado"
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn("Token invalido o expirado", {
      method: req.method,
      url: req.originalUrl,
      tokenPrefix: token.slice(0, 8)
    });

    return res.status(401).json({
      ok: false,
      message: "Token invalido o expirado"
    });
  }
};

module.exports = authMiddleware;
