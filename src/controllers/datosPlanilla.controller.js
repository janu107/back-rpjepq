const service = require("../services/datosPlanilla.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Datos planilla listados correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Datos planilla obtenidos correctamente"); } catch (error) { next(error); } };
const getByPersona = async (req, res, next) => {
  try {
    const { tipoManejo, idEmpleado } = req.query;
    const data = await service.getByPersona(tipoManejo, idEmpleado);
    return successResponse(res, data, "Datos planilla obtenidos correctamente");
  } catch (error) { next(error); }
};
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Datos planilla creados correctamente", 201); } catch (error) { next(error); } };
const update = async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user), "Datos planilla actualizados correctamente"); } catch (error) { next(error); } };

module.exports = { list, getById, getByPersona, create, update };
