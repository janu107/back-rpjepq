const service = require("../services/jubiladosModulo.service");
const { successResponse } = require("../utils/response");

const buscar = async (req, res, next) => { try { return successResponse(res, await service.buscar(req.query.q, req.query.estado), "Jubilados encontrados"); } catch (e) { next(e); } };
const noAmparistas = async (req, res, next) => { try { return successResponse(res, await service.noAmparistas(req.query.q), "Jubilados no amparistas"); } catch (e) { next(e); } };
const deudaTotal = async (req, res, next) => { try { return successResponse(res, await service.deudaTotal(req.params.id), "Deuda total obtenida"); } catch (e) { next(e); } };
const beneficiariosRegistrados = async (req, res, next) => { try { return successResponse(res, await service.beneficiariosRegistrados(req.params.id), "Beneficiarios registrados"); } catch (e) { next(e); } };
const beneficiariosActivos = async (req, res, next) => { try { return successResponse(res, await service.beneficiariosActivos(req.params.id), "Beneficiarios activos"); } catch (e) { next(e); } };
const resumenFinanciero = async (req, res, next) => { try { return successResponse(res, await service.resumenFinanciero(req.params.id), "Resumen financiero"); } catch (e) { next(e); } };
const ultimosPagos = async (req, res, next) => { try { return successResponse(res, await service.ultimosPagos(req.params.id, req.query.limit), "Últimos pagos"); } catch (e) { next(e); } };
const deudaDetalle = async (req, res, next) => { try { return successResponse(res, await service.deudaDetalle(req.params.id), "Detalle de deuda"); } catch (e) { next(e); } };
const historiaCompleta = async (req, res, next) => { try { return successResponse(res, await service.historiaCompleta(req.params.id), "Historia completa"); } catch (e) { next(e); } };
const fallecimiento = async (req, res, next) => { try { return successResponse(res, await service.registrarFallecimiento(req.params.id, req.body, req.user), "FALLECIMIENTO REGISTRADO CORRECTAMENTE"); } catch (e) { next(e); } };
const estadoCuentaPdf = async (req, res, next) => {
  try {
    const buffer = await service.generarEstadoCuentaPdf(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="estado_cuenta_${req.params.id}.pdf"`);
    res.send(buffer);
  } catch (e) { next(e); }
};

module.exports = {
  buscar, noAmparistas, deudaTotal, beneficiariosRegistrados, beneficiariosActivos,
  resumenFinanciero, ultimosPagos, deudaDetalle, historiaCompleta, fallecimiento, estadoCuentaPdf
};
