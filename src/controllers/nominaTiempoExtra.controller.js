const service = require("../services/nominaTiempoExtra.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => { try { return successResponse(res, await service.list(), "Planillas de tiempo extra listadas correctamente"); } catch (error) { next(error); } };
const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Planilla obtenida correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user), "Planilla creada correctamente", 201); } catch (error) { next(error); } };
const generar = async (req, res, next) => { try { return successResponse(res, await service.generar(req.params.id, req.user), "Nómina de tiempo extra generada correctamente"); } catch (error) { next(error); } };
const getDetalle = async (req, res, next) => { try { return successResponse(res, await service.getDetalle(req.params.id), "Detalle obtenido correctamente"); } catch (error) { next(error); } };
const cerrar = async (req, res, next) => { try { return successResponse(res, await service.cerrar(req.params.id, req.user), "PLANILLA DE TIEMPO EXTRA CERRADA CORRECTAMENTE"); } catch (error) { next(error); } };
const reversar = async (req, res, next) => { try { return successResponse(res, await service.reversar(req.params.id, req.body.motivo, req.user), "PLANILLA DE TIEMPO EXTRA REVERSADA CORRECTAMENTE"); } catch (error) { next(error); } };
const exportExcel = async (req, res, next) => {
  try {
    const { buffer, filename } = await service.exportExcel(req.params.id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (error) { next(error); }
};
const exportBanco = async (req, res, next) => {
  try {
    const { content, filename } = await service.exportBanco(req.params.id);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  } catch (error) { next(error); }
};

module.exports = { list, getById, create, generar, getDetalle, cerrar, reversar, exportExcel, exportBanco };
