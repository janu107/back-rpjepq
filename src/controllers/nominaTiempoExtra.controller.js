const service = require("../services/nominaTiempoExtra.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Planillas de tiempo extra listadas correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Planilla obtenida correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Planilla creada correctamente", 201); } catch (error) { next(error); } };
const generar = async (req, res, next) => { try { return successResponse(res, await service.generar(req.params.id, req.user), "Nómina de tiempo extra generada correctamente"); } catch (error) { next(error); } };
const getDetalle = async (req, res, next) => { try { return successResponse(res, await service.getDetalle(req.params.id), "Detalle obtenido correctamente"); } catch (error) { next(error); } };

module.exports = { list, getById, create, generar, getDetalle };
