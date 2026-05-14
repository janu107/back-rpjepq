const authService = require("../services/auth.service");
const { auditFromRequest } = require("../middlewares/audit.middleware");
const { successResponse } = require("../utils/response");

const login = async (req, res, next) => {
  try {
    const { usuario, contrasena, password } = req.body;
    const data = await authService.login(usuario, contrasena || password);
    req.user = data.user;
    await auditFromRequest(req, { modulo: "AUTH", accion: "LOGIN_EXITOSO", descripcion: `Login exitoso para ${usuario}` });

    return successResponse(res, data, "Login correcto");
  } catch (error) {
    await auditFromRequest(req, { modulo: "AUTH", accion: "LOGIN_FALLIDO", descripcion: `Login fallido para ${req.body?.usuario || "desconocido"}` });
    next(error);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.user.id);

    return successResponse(res, user, "Sesion vigente");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  me
};
