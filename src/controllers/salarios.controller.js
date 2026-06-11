const service = require("../services/salarios.service");
const { successResponse } = require("../utils/response");
const list = async (req, res, next) => { try { return successResponse(res, await service.list(req.query), "Salarios listados correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Salario obtenido correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Salario creado correctamente", 201); } catch (error) { next(error); } };
const bulkCreate = async (req, res, next) => { try { return successResponse(res, await service.bulkCreate(req.body, req.user), "Salarios guardados correctamente", 201); } catch (error) { next(error); } };
const update = async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user), "Salario actualizado correctamente"); } catch (error) { next(error); } };
const remove = async (req, res, next) => { try { return successResponse(res, await service.remove(req.params.id, req.user), "Salario eliminado correctamente"); } catch (error) { next(error); } };
module.exports = { list, getById, create, bulkCreate, update, remove };
