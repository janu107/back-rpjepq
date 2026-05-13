const service = require("../services/detallePrestamos.service");
const { successResponse } = require("../utils/response");

const listByPrestamo = async (req, res, next) => { try { return successResponse(res, await service.listByPrestamo(req.params.id), "Detalle listado correctamente"); } catch (error) { next(error); } };
const createDetalle = async (req, res, next) => { try { return successResponse(res, await service.createDetalle(req.params.id, req.body, req.user), "Detalle creado correctamente", 201); } catch (error) { next(error); } };
const updateDetalle = async (req, res, next) => { try { return successResponse(res, await service.updateDetalle(req.params.detalleId, req.body, req.user), "Detalle actualizado correctamente"); } catch (error) { next(error); } };
const removeDetalle = async (req, res, next) => { try { return successResponse(res, await service.removeDetalle(req.params.detalleId, req.user), "Detalle eliminado correctamente"); } catch (error) { next(error); } };
const getSaldo = async (req, res, next) => { try { return successResponse(res, await service.getSaldo(req.params.id), "Saldo obtenido correctamente"); } catch (error) { next(error); } };
const getTotalPagado = async (req, res, next) => { try { return successResponse(res, await service.getTotalPagado(req.params.id), "Total pagado obtenido correctamente"); } catch (error) { next(error); } };

module.exports = { listByPrestamo, createDetalle, updateDetalle, removeDetalle, getSaldo, getTotalPagado };
