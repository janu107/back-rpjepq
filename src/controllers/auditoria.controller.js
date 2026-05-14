const auditoriaService = require("../services/auditoria.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => {
  try {
    const data = await auditoriaService.listar(req.query);
    return successResponse(res, data, "Auditoria listada correctamente");
  } catch (error) {
    next(error);
  }
};

const getById = async (req, res, next) => {
  try {
    const data = await auditoriaService.obtenerPorId(req.params.id);
    return successResponse(res, data, "Registro de auditoria obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const modulos = async (req, res, next) => {
  try {
    return successResponse(res, await auditoriaService.listarModulos(), "Modulos de auditoria listados correctamente");
  } catch (error) {
    next(error);
  }
};

const acciones = async (req, res, next) => {
  try {
    return successResponse(res, await auditoriaService.listarAcciones(), "Acciones de auditoria listadas correctamente");
  } catch (error) {
    next(error);
  }
};

module.exports = { list, getById, modulos, acciones };
