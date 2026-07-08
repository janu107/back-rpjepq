const service = require("../services/nominasJubilados.service");
const { successResponse } = require("../utils/response");

const generarJubilados = async (req, res, next) => { try { return successResponse(res, await service.generarJubilados(req.body.idPlanilla, req.body.tipoIngreso, req.user), "NÓMINA DE JUBILADOS GENERADA CORRECTAMENTE"); } catch (e) { next(e); } };
const generarAmparistas = async (req, res, next) => { try { return successResponse(res, await service.generarAmparistas(req.body.idPlanilla, req.user), "NÓMINA DE AMPARISTAS GENERADA CORRECTAMENTE"); } catch (e) { next(e); } };
const revertir = async (req, res, next) => { try { return successResponse(res, await service.revertir(req.params.idPlanilla, req.body.motivo, req.user), "NÓMINA REVERSADA CORRECTAMENTE"); } catch (e) { next(e); } };

module.exports = { generarJubilados, generarAmparistas, revertir };
