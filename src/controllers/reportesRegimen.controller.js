const service = require("../services/reportesRegimen.service");
const { successResponse } = require("../utils/response");

const prestamosRegimen = async (req, res, next) => { try { return successResponse(res, await service.getPrestamosRegimen(), "Reporte préstamos régimen obtenido"); } catch (error) { next(error); } };
const juntaDirectiva = async (req, res, next) => { try { return successResponse(res, await service.getJuntaDirectiva(), "Reporte junta directiva obtenido"); } catch (error) { next(error); } };
const dietas = async (req, res, next) => { try { return successResponse(res, await service.getDietas(), "Reporte dietas obtenido"); } catch (error) { next(error); } };
const empleadosRegimen = async (req, res, next) => { try { return successResponse(res, await service.getEmpleadosRegimen(), "Reporte empleados régimen obtenido"); } catch (error) { next(error); } };
const aportaciones = async (req, res, next) => { try { return successResponse(res, await service.getAportaciones(), "Reporte aportaciones obtenido"); } catch (error) { next(error); } };

module.exports = { prestamosRegimen, juntaDirectiva, dietas, empleadosRegimen, aportaciones };
