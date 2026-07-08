const service = require("../services/beneficiarios.service");
const { successResponse } = require("../utils/response");

const buscarJubilados = async (req, res, next) => { try { return successResponse(res, await service.buscarJubilados(req.query.q), "Jubilados encontrados"); } catch (e) { next(e); } };
const getByJubilado = async (req, res, next) => { try { return successResponse(res, await service.getByJubilado(req.params.id), "Beneficiarios del jubilado obtenidos"); } catch (e) { next(e); } };
const registrarLote = async (req, res, next) => { try { return successResponse(res, await service.registrarLote(req.body, req.user), "Beneficiarios guardados correctamente", 201); } catch (e) { next(e); } };
const remove = async (req, res, next) => { try { return successResponse(res, await service.remove(req.params.id, req.user), "Beneficiario eliminado correctamente"); } catch (e) { next(e); } };
const registrarTutor = async (req, res, next) => { try { return successResponse(res, await service.registrarTutor(req.body, req.user), "Tutora registrada correctamente", 201); } catch (e) { next(e); } };
const getActivos = async (req, res, next) => { try { return successResponse(res, await service.getActivos(req.query.q), "Beneficiarios activos obtenidos"); } catch (e) { next(e); } };
const getSuspendidos = async (req, res, next) => { try { return successResponse(res, await service.getSuspendidos(), "Beneficiarios suspendidos obtenidos"); } catch (e) { next(e); } };
const suspender = async (req, res, next) => { try { return successResponse(res, await service.suspender(req.params.id, req.body, req.user), "BENEFICIARIO SUSPENDIDO CORRECTAMENTE"); } catch (e) { next(e); } };
const reactivar = async (req, res, next) => { try { return successResponse(res, await service.reactivar(req.params.id, req.user), "BENEFICIARIO REACTIVADO CORRECTAMENTE"); } catch (e) { next(e); } };

module.exports = {
  buscarJubilados, getByJubilado, registrarLote, remove, registrarTutor,
  getActivos, getSuspendidos, suspender, reactivar
};
