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
const previewNominaPrestamos = async (req, res, next) => { try { return successResponse(res, await service.getNominaPrestamos(req.query), "Nómina de préstamos obtenida correctamente"); } catch (e) { next(e); } };

// --- Impresiones PDF ---------------------------------------------------------
const pdfNominaSueldos = async (req, res, next) => { try { return enviarPdf(res, await service.pdfNominaSueldos(req.params.idPlanilla, req.query, req.user)); } catch (e) { next(e); } };
const pdfNominaTiempoExtra = async (req, res, next) => { try { return enviarPdf(res, await service.pdfNominaTiempoExtra(req.params.idPlanilla, req.query, req.user)); } catch (e) { next(e); } };
const pdfEstadoCuenta = async (req, res, next) => { try { return enviarPdf(res, await service.pdfEstadoCuentaPrestamo(req.params.idPrestamo, req.query, req.user)); } catch (e) { next(e); } };
const pdfResumen = async (req, res, next) => { try { return enviarPdf(res, await service.pdfResumen(req.query, req.user)); } catch (e) { next(e); } };
const pdfNominaPrestamos = async (req, res, next) => { try { return enviarPdf(res, await service.pdfNominaPrestamos(req.query, req.user)); } catch (e) { next(e); } };

module.exports = {
  previewNominaSueldos, previewNominaTiempoExtra, previewEstadoCuenta, previewResumen, previewNominaPrestamos,
  pdfNominaSueldos, pdfNominaTiempoExtra, pdfEstadoCuenta, pdfResumen, pdfNominaPrestamos
};
