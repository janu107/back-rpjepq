const service = require("../services/convenios.service");
const { successResponse } = require("../utils/response");

const candidatos = async (req, res, next) => { try { return successResponse(res, await service.candidatos(req.query.q), "Candidatos a convenio"); } catch (e) { next(e); } };
const deuda = async (req, res, next) => { try { return successResponse(res, await service.deudaPorPersona(req.params.tipo, req.params.id), "Deuda del titular"); } catch (e) { next(e); } };
const crear = async (req, res, next) => { try { return successResponse(res, await service.crear(req.body, req.user), "CONVENIO CREADO CORRECTAMENTE", 201); } catch (e) { next(e); } };
const vigentes = async (req, res, next) => { try { return successResponse(res, await service.vigentes(), "Convenios vigentes"); } catch (e) { next(e); } };
const cancelar = async (req, res, next) => { try { return successResponse(res, await service.cancelar(req.params.id, req.user), "CONVENIO CANCELADO CORRECTAMENTE"); } catch (e) { next(e); } };

module.exports = { candidatos, deuda, crear, vigentes, cancelar };
