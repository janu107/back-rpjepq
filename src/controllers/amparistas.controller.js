const service = require("../services/amparistas.service");
const { successResponse } = require("../utils/response");

const registrar = async (req, res, next) => { try { return successResponse(res, await service.registrar(req.body, req.user), "AMPARISTA REGISTRADO CORRECTAMENTE", 201); } catch (e) { next(e); } };
const vigentes = async (req, res, next) => { try { return successResponse(res, await service.vigentes(), "Amparistas vigentes"); } catch (e) { next(e); } };
const revocar = async (req, res, next) => { try { return successResponse(res, await service.revocar(req.params.id, req.body.motivo, req.user), "AMPARISTA REVOCADO CORRECTAMENTE"); } catch (e) { next(e); } };

const verificarExpediente = async (req, res, next) => { try { return successResponse(res, await service.verificarExpediente(req.query.exp), "Verificación de expediente"); } catch (e) { next(e); } };

module.exports = { registrar, vigentes, revocar, verificarExpediente };
