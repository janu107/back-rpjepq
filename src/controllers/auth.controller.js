const authService = require("../services/auth.service");
const { successResponse } = require("../utils/response");

const login = async (req, res, next) => {
  try {
    const { usuario, contrasena, password } = req.body;
    const data = await authService.login(usuario, contrasena || password);

    return successResponse(res, data, "Login correcto");
  } catch (error) {
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
