const service = require("../services/sesiones.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Sesiones listadas correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Sesión obtenida correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Sesión registrada correctamente", 201); } catch (error) { next(error); } };
const update = async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user), "Sesión actualizada correctamente"); } catch (error) { next(error); } };
const anular = async (req, res, next) => { try { return successResponse(res, await service.anular(req.params.id, req.user), "Sesión anulada correctamente"); } catch (error) { next(error); } };
const getAsistencia = async (req, res, next) => { try { return successResponse(res, await service.getAsistencia(req.params.id), "Asistencia obtenida correctamente"); } catch (error) { next(error); } };

module.exports = { list, getById, create, update, anular, getAsistencia };
