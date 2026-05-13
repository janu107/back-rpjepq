const service = require("../services/nominaDescuentos.service");
const { successResponse } = require("../utils/response");
const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Descuentos de nomina listados correctamente"); } catch (e) { next(e); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Descuento de nomina obtenido correctamente"); } catch (e) { next(e); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Descuento de nomina creado correctamente", 201); } catch (e) { next(e); } };
const update = async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user), "Descuento de nomina actualizado correctamente"); } catch (e) { next(e); } };
const remove = async (req, res, next) => { try { return successResponse(res, await service.remove(req.params.id, req.user), "Descuento de nomina eliminado correctamente"); } catch (e) { next(e); } };
const total = async (req, res, next) => { try { return successResponse(res, await service.totalByPlanilla(req.params.idPlanilla), "Total de descuentos obtenido correctamente"); } catch (e) { next(e); } };
module.exports = { list, getById, create, update, remove, total };
