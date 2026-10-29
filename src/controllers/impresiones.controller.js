const service = require("../services/impresiones.service");
const { successResponse } = require("../utils/response");

// Envía un PDF como descarga.
const enviarPdf = (res, { buffer, filename }) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(buffer);
};

// --- Vistas previas (JSON, para revisar en pantalla antes de imprimir) -------
const previewNominaSueldos = async (req, res, next) => { try { return successResponse(res, await service.getNominaSueldos(req.params.idPlanilla), "Nómina de sueldos obtenida correctamente"); } catch (e) { next(e); } };
const previewNominaTiempoExtra = async (req, res, next) => { try { return successResponse(res, await service.getNominaTiempoExtra(req.params.idPlanilla), "Nómina de tiempo extra obtenida correctamente"); } catch (e) { next(e); } };
const previewEstadoCuenta = async (req, res, next) => { try { return successResponse(res, await service.getEstadoCuentaPrestamo(req.params.idPrestamo), "Estado de cuenta obtenido correctamente"); } catch (e) { next(e); } };
const previewResumen = async (req, res, next) => { try { return successResponse(res, await service.getResumen(req.query), "Resumen obtenido correctamente"); } catch (e) { next(e); } };
const previewEstadoAportaciones = async (req, res, next) => { try { return successResponse(res, await service.getEstadoAportaciones(req.params.idAportacion), "Estado de aportaciones obtenido correctamente"); } catch (e) { next(e); } };
const previewNominaJubilados = async (req, res, next) => { try { return successResponse(res, await service.getNominaJubilados(req.params.idPlanilla, req.query), "Nómina de jubilados obtenida correctamente"); } catch (e) { next(e); } };
const previewResumenJubilados = async (req, res, next) => { try { return successResponse(res, await service.getResumenJubilados(req.params.idPlanilla, req.query), "Resumen de jubilados obtenido correctamente"); } catch (e) { next(e); } };
const previewNominaPrestamos = async (req, res, next) => { try { return successResponse(res, await service.getNominaPrestamos(req.query), "Nómina de préstamos obtenida correctamente"); } catch (e) { next(e); } };

const opciones = async (req, res, next) => { try { return successResponse(res, await service.getOpciones(), "Opciones obtenidas correctamente"); } catch (e) { next(e); } };

// --- Impresiones PDF ---------------------------------------------------------
const pdfNominaSueldos = async (req, res, next) => { try { return enviarPdf(res, await service.pdfNominaSueldos(req.params.idPlanilla, req.query, req.user)); } catch (e) { next(e); } };
const pdfNominaTiempoExtra = async (req, res, next) => { try { return enviarPdf(res, await service.pdfNominaTiempoExtra(req.params.idPlanilla, req.query, req.user)); } catch (e) { next(e); } };
const pdfEstadoCuenta = async (req, res, next) => { try { return enviarPdf(res, await service.pdfEstadoCuentaPrestamo(req.params.idPrestamo, req.query, req.user)); } catch (e) { next(e); } };
const pdfResumen = async (req, res, next) => { try { return enviarPdf(res, await service.pdfResumen(req.query, req.user)); } catch (e) { next(e); } };
const excelEstadoAportaciones = async (req, res, next) => {
  try {
    const { buffer, filename } = await service.excelEstadoAportaciones(req.params.idAportacion);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) { next(e); }
};
const pdfEstadoAportaciones = async (req, res, next) => { try { return enviarPdf(res, await service.pdfEstadoAportaciones(req.params.idAportacion, req.query, req.user)); } catch (e) { next(e); } };
const pdfNominaJubilados = async (req, res, next) => { try { return enviarPdf(res, await service.pdfNominaJubilados(req.params.idPlanilla, req.query, req.user)); } catch (e) { next(e); } };
const pdfResumenJubilados = async (req, res, next) => { try { return enviarPdf(res, await service.pdfResumenJubilados(req.params.idPlanilla, req.query, req.user)); } catch (e) { next(e); } };
const pdfNominaPrestamos = async (req, res, next) => { try { return enviarPdf(res, await service.pdfNominaPrestamos(req.query, req.user)); } catch (e) { next(e); } };

// --- Depósitos por banco (planilla de jubilados) -----------------------------
const depositos = require("../services/depositosBanco.service");
const enviarArchivo = (res, { buffer, filename }, tipo) => {
  res.setHeader("Content-Type", tipo);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(buffer);
};
const depositosPlanillas = async (req, res, next) => { try { return successResponse(res, await depositos.planillas(), "Planillas de jubilados"); } catch (e) { next(e); } };
const depositosPreview = async (req, res, next) => { try { const d = await depositos.getDepositos(req.params.idPlanilla, req.query); return successResponse(res, { planilla: d.planilla, bancos: d.bancos, tipos: d.tipos, matriz: d.matriz, totalBanco: d.totalBanco, total: d.total, depositos: d.filas.length }, "Depósitos por banco"); } catch (e) { next(e); } };
const depositosPdf = async (req, res, next) => { try { return enviarPdf(res, await depositos.pdfDepositos(req.params.idPlanilla, req.query, req.user)); } catch (e) { next(e); } };
const excelNominaSueldos = async (req, res, next) => { try { return enviarArchivo(res, await service.excelNominaSueldos(req.params.idPlanilla, req.query), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); } catch (e) { next(e); } };
const depositosExcel = async (req, res, next) => { try { return enviarArchivo(res, await depositos.excelDepositos(req.params.idPlanilla, req.query), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); } catch (e) { next(e); } };

module.exports = {
  depositosPlanillas, depositosPreview, depositosPdf, depositosExcel, excelNominaSueldos,
  opciones,
  previewNominaSueldos, previewNominaTiempoExtra, previewEstadoCuenta, previewResumen, previewNominaPrestamos,
  previewEstadoAportaciones, previewNominaJubilados, previewResumenJubilados,
  pdfNominaSueldos, pdfNominaTiempoExtra, pdfEstadoCuenta, pdfResumen, pdfNominaPrestamos,
  pdfEstadoAportaciones, excelEstadoAportaciones, pdfNominaJubilados, pdfResumenJubilados
};
