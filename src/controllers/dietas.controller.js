const service = require("../services/dietas.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Dietas listadas correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Dieta obtenida correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Dieta creada correctamente", 201); } catch (error) { next(error); } };
const update = async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user), "Dieta actualizada correctamente"); } catch (error) { next(error); } };
const remove = async (req, res, next) => { try { return successResponse(res, await service.remove(req.params.id, req.user), "Dieta eliminada correctamente"); } catch (error) { next(error); } };

// Maestro-detalle: pagos del mes, recálculo, detalle de sesiones y estados.
const pagosDelMes = async (req, res, next) => { try { return successResponse(res, await service.pagosDelMes(req.query.periodo), "Pagos del mes obtenidos correctamente"); } catch (error) { next(error); } };
const recalcular = async (req, res, next) => { try { return successResponse(res, await service.recalcular(req.body.periodo), "Totales recalculados correctamente"); } catch (error) { next(error); } };
const detalle = async (req, res, next) => { try { return successResponse(res, await service.detalle(req.params.id), "Detalle del pago obtenido correctamente"); } catch (error) { next(error); } };
const pagar = async (req, res, next) => { try { return successResponse(res, await service.marcarPagado(req.params.id, req.body, req.user), "Pago emitido correctamente"); } catch (error) { next(error); } };
const recibir = async (req, res, next) => { try { return successResponse(res, await service.marcarRecibido(req.params.id, req.body, req.user), "Pago marcado como recibido"); } catch (error) { next(error); } };

module.exports = { list, getById, create, update, remove, pagosDelMes, recalcular, detalle, pagar, recibir };
