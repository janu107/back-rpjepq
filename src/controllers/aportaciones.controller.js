const service = require("../services/aportaciones.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Aportaciones listadas correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Aportacion obtenida correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Aportacion creada correctamente", 201); } catch (error) { next(error); } };
const update = async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user), "Aportacion actualizada correctamente"); } catch (error) { next(error); } };
const changeStatus = async (req, res, next) => { try { return successResponse(res, await service.changeStatus(req.params.id, req.body.estado, req.user), "Estado actualizado correctamente"); } catch (error) { next(error); } };
const remove = async (req, res, next) => { try { return successResponse(res, await service.remove(req.params.id, req.user), "Aportacion eliminada correctamente"); } catch (error) { next(error); } };

module.exports = { list, getById, create, update, changeStatus, remove };
