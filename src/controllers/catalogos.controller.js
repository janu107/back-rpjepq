const catalogosService = require("../services/catalogos.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => {
  try {
    const data = await catalogosService.list(req.params.catalogo);
    return successResponse(res, data, "Catalogo listado correctamente");
  } catch (error) {
    next(error);
  }
};

const getById = async (req, res, next) => {
  try {
    const data = await catalogosService.getById(req.params.catalogo, req.params.id);
    return successResponse(res, data, "Registro obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const data = await catalogosService.create(req.params.catalogo, req.body, req.user);
    return successResponse(res, data, "Registro creado correctamente", 201);
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const data = await catalogosService.update(req.params.catalogo, req.params.id, req.body, req.user);
    return successResponse(res, data, "Registro actualizado correctamente");
  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    const data = await catalogosService.remove(req.params.catalogo, req.params.id, req.user);
    return successResponse(res, data, "Registro eliminado correctamente");
  } catch (error) {
    next(error);
  }
};

module.exports = { list, getById, create, update, remove };
