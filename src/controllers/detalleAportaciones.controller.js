const service = require("../services/detalleAportaciones.service");
const { successResponse } = require("../utils/response");

const listByAportacion = async (req, res, next) => { try { return successResponse(res, await service.listByAportacion(req.params.id), "Detalle listado correctamente"); } catch (error) { next(error); } };
const createDetalle = async (req, res, next) => { try { return successResponse(res, await service.createDetalle(req.params.id, req.body, req.user), "Detalle creado correctamente", 201); } catch (error) { next(error); } };
const updateDetalle = async (req, res, next) => { try { return successResponse(res, await service.updateDetalle(req.params.detalleId, req.body, req.user), "Detalle actualizado correctamente"); } catch (error) { next(error); } };
const removeDetalle = async (req, res, next) => { try { return successResponse(res, await service.removeDetalle(req.params.detalleId, req.user), "Detalle eliminado correctamente"); } catch (error) { next(error); } };
const getTotal = async (req, res, next) => { try { return successResponse(res, await service.getTotal(req.params.id), "Total aportado obtenido correctamente"); } catch (error) { next(error); } };

module.exports = { listByAportacion, createDetalle, updateDetalle, removeDetalle, getTotal };
