const service = require("../services/nominaResumen.service");
const { successResponse } = require("../utils/response");
const porPlanilla = async (req, res, next) => { try { return successResponse(res, await service.resumenPorPlanilla(req.params.idPlanilla), "Resumen por planilla obtenido correctamente"); } catch (e) { next(e); } };
const porEmpleado = async (req, res, next) => { try { return successResponse(res, await service.resumenPorEmpleado(req.params.idEmpleado), "Resumen por empleado obtenido correctamente"); } catch (e) { next(e); } };
const porJubilado = async (req, res, next) => { try { return successResponse(res, await service.resumenPorJubilado(req.params.idJubilado), "Resumen por jubilado obtenido correctamente"); } catch (e) { next(e); } };
module.exports = { porPlanilla, porEmpleado, porJubilado };
