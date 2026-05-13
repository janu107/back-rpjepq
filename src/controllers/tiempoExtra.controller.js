const service = require("../services/tiempoExtra.service");
const { successResponse } = require("../utils/response");
const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Tiempo extra listado correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Tiempo extra obtenido correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Tiempo extra creado correctamente", 201); } catch (error) { next(error); } };
const update = async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user), "Tiempo extra actualizado correctamente"); } catch (error) { next(error); } };
const remove = async (req, res, next) => { try { return successResponse(res, await service.remove(req.params.id, req.user), "Tiempo extra eliminado correctamente"); } catch (error) { next(error); } };
module.exports = { list, getById, create, update, remove };
