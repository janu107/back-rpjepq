const service = require("../services/reportesJubilados.service");
const { successResponse } = require("../utils/response");

const dashboard = async (req, res, next) => { try { return successResponse(res, await service.dashboardResumen(), "Resumen del dashboard"); } catch (e) { next(e); } };
const saldos = async (req, res, next) => { try { return successResponse(res, await service.saldos(), "Reporte de saldos"); } catch (e) { next(e); } };
const pagos = async (req, res, next) => { try { return successResponse(res, await service.pagos(req.query.desde, req.query.hasta), "Reporte de pagos"); } catch (e) { next(e); } };
const beneficiariosActivos = async (req, res, next) => { try { return successResponse(res, await service.beneficiariosActivos(), "Beneficiarios activos"); } catch (e) { next(e); } };
const convenios = async (req, res, next) => { try { return successResponse(res, await service.convenios(), "Reporte de convenios"); } catch (e) { next(e); } };
const deudaPorTipo = async (req, res, next) => { try { return successResponse(res, await service.deudaPorTipo(), "Deuda por tipo"); } catch (e) { next(e); } };
const amparistas = async (req, res, next) => { try { return successResponse(res, await service.amparistas(), "Reporte de amparistas"); } catch (e) { next(e); } };

module.exports = { dashboard, saldos, pagos, beneficiariosActivos, convenios, deudaPorTipo, amparistas };
