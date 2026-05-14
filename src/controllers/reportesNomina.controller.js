const service = require("../services/reportesNomina.service");
const { successResponse } = require("../utils/response");

const sendDownload = (res, buffer, filename, contentType) => {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(Buffer.from(buffer));
};

const planillas = async (req, res, next) => {
  try {
    return successResponse(res, await service.listarPlanillas(), "Planillas con resumen listadas correctamente");
  } catch (error) {
    next(error);
  }
};

const planilla = async (req, res, next) => {
  try {
    return successResponse(res, await service.getReportePlanilla(req.params.idPlanilla), "Reporte de planilla obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const empleado = async (req, res, next) => {
  try {
    return successResponse(res, await service.getReporteEmpleado(req.params.idEmpleado, req.query.idPlanilla || null), "Reporte por empleado obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const jubilado = async (req, res, next) => {
  try {
    return successResponse(res, await service.getReporteJubilado(req.params.idJubilado, req.query.idPlanilla || null), "Reporte por jubilado obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const planillaPdf = async (req, res, next) => {
  try {
    const buffer = await service.exportarPdfPlanilla(req.params.idPlanilla, req.user);
    return sendDownload(res, buffer, `reporte_planilla_${req.params.idPlanilla}.pdf`, "application/pdf");
  } catch (error) {
    next(error);
  }
};

const planillaExcel = async (req, res, next) => {
  try {
    const buffer = await service.exportarExcelPlanilla(req.params.idPlanilla);
    return sendDownload(res, buffer, `reporte_planilla_${req.params.idPlanilla}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (error) {
    next(error);
  }
};

const ingresosExcel = async (req, res, next) => {
  try {
    const buffer = await service.exportarIngresosExcel(req.params.idPlanilla);
    return sendDownload(res, buffer, `ingresos_planilla_${req.params.idPlanilla}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (error) {
    next(error);
  }
};

const descuentosExcel = async (req, res, next) => {
  try {
    const buffer = await service.exportarDescuentosExcel(req.params.idPlanilla);
    return sendDownload(res, buffer, `descuentos_planilla_${req.params.idPlanilla}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (error) {
    next(error);
  }
};

module.exports = { planillas, planilla, empleado, jubilado, planillaPdf, planillaExcel, ingresosExcel, descuentosExcel };
