const service = require("../services/juntaDirectiva.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Junta directiva listada correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Miembro de junta obtenido correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Miembro de junta creado correctamente", 201); } catch (error) { next(error); } };
const update = async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user), "Miembro de junta actualizado correctamente"); } catch (error) { next(error); } };
const remove = async (req, res, next) => { try { return successResponse(res, await service.remove(req.params.id, req.user), "Miembro de junta eliminado correctamente"); } catch (error) { next(error); } };

module.exports = { list, getById, create, update, remove };
