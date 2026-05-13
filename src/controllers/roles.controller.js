const rolesService = require("../services/roles.service");
const { successResponse } = require("../utils/response");

const listRoles = async (req, res, next) => {
  try {
    const roles = await rolesService.listRoles();
    return successResponse(res, roles, "Roles listados correctamente");
  } catch (error) {
    next(error);
  }
};

const listRoleTypes = (req, res) => {
  return successResponse(res, rolesService.TIPOS_ROL, "Tipos de rol listados correctamente");
};

const updateUserRole = async (req, res, next) => {
  try {
    const data = await rolesService.upsertUserRole(req.params.id, req.body.rol, req.user?.usuario);
    return successResponse(res, data, "Rol actualizado correctamente");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listRoles,
  listRoleTypes,
  updateUserRole
};
