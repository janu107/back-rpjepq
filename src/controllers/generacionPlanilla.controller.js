const service = require("../services/generacionPlanilla.service");
const { successResponse } = require("../utils/response");

const preview = async (req, res, next) => {
  try {
    const data = await service.preview(req.body);
    return successResponse(res, data, "Previsualizacion generada correctamente");
  } catch (error) {
    next(error);
  }
};

const generar = async (req, res, next) => {
  try {
    const data = await service.generar(req.body, req.user);
    return successResponse(res, data, "Planilla generada correctamente.", 201);
  } catch (error) {
    next(error);
  }
};

const validar = async (req, res, next) => {
  try {
    const data = await service.validar(req.params.idPlanilla);
    return successResponse(res, data, "Validacion de planilla realizada correctamente");
  } catch (error) {
    next(error);
  }
};

const limpiar = async (req, res, next) => {
  try {
    const data = await service.limpiar(req.params.idPlanilla, req.user);
    return successResponse(res, data, "Planilla limpiada correctamente");
  } catch (error) {
    next(error);
  }
};

const resumen = async (req, res, next) => {
  try {
    const data = await service.resumen(req.params.idPlanilla);
    return successResponse(res, data, "Resumen de generacion obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

module.exports = { preview, generar, validar, limpiar, resumen };
