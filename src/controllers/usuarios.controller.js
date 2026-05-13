const usuariosService = require("../services/usuarios.service");
const { successResponse } = require("../utils/response");

const listUsers = async (req, res, next) => {
  try {
    const users = await usuariosService.listUsers();
    return successResponse(res, users, "Usuarios listados correctamente");
  } catch (error) {
    next(error);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const user = await usuariosService.getUserById(req.params.id);
    return successResponse(res, user, "Usuario obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  try {
    const user = await usuariosService.createUser(req.body, req.user);
    return successResponse(res, user, "Usuario creado correctamente", 201);
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const user = await usuariosService.updateUser(req.params.id, req.body, req.user);
    return successResponse(res, user, "Usuario actualizado correctamente");
  } catch (error) {
    next(error);
  }
};

const changeStatus = async (req, res, next) => {
  try {
    const user = await usuariosService.changeStatus(req.params.id, req.body.estado, req.user);
    return successResponse(res, user, "Estado actualizado correctamente");
  } catch (error) {
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const data = await usuariosService.changePassword(req.params.id, req.body.contrasena, req.user);
    return successResponse(res, data, "Contrasena actualizada correctamente");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  changeStatus,
  changePassword
};
