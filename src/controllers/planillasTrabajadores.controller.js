const service = require("../services/planillasTrabajadores.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => {
  try {
    const data = await service.list();
    return successResponse(res, data, "Planillas de empleados obtenidas correctamente");
  } catch (e) { next(e); }
};

const getById = async (req, res, next) => {
  try {
    const data = await service.getById(req.params.id);
    return successResponse(res, data);
  } catch (e) { next(e); }
};

const create = async (req, res, next) => {
  try {
    const data = await service.create(req.body, req.user);
    return successResponse(res, data, "Planilla creada correctamente", 201);
  } catch (e) { next(e); }
};

const update = async (req, res, next) => {
  try {
    const data = await service.update(req.params.id, req.body, req.user);
    return successResponse(res, data, "Planilla actualizada correctamente");
  } catch (e) { next(e); }
};

const preview = async (req, res, next) => {
  try {
    const data = await service.preview(req.params.id);
    return successResponse(res, data, "Vista previa generada correctamente");
  } catch (e) { next(e); }
};

const generar = async (req, res, next) => {
  try {
    const data = await service.generar(req.params.id, req.user);
    return successResponse(res, data, "PLANILLA GENERADA CORRECTAMENTE");
  } catch (e) { next(e); }
};

const getDetalle = async (req, res, next) => {
  try {
    const data = await service.getDetalle(req.params.id);
    return successResponse(res, data, "Detalle de nómina obtenido correctamente");
  } catch (e) { next(e); }
};

const cerrar = async (req, res, next) => {
  try {
    const data = await service.cerrar(req.params.id, req.user);
    return successResponse(res, data, "PLANILLA CERRADA CORRECTAMENTE");
  } catch (e) { next(e); }
};

const reversar = async (req, res, next) => {
  try {
    const data = await service.reversar(req.params.id, req.body.motivo, req.user);
    return successResponse(res, data, "PLANILLA REVERSADA CORRECTAMENTE");
  } catch (e) { next(e); }
};

const reversarEmpleado = async (req, res, next) => {
  try {
    const data = await service.reversarEmpleado(req.params.id, req.params.eid, req.body.motivo, req.user);
    return successResponse(res, data, "PAGO DE EMPLEADO REVERSADO CORRECTAMENTE");
  } catch (e) { next(e); }
};

const getMontos = async (req, res, next) => {
  try {
    const data = await service.getMontos(req.params.id, req.params.eid);
    return successResponse(res, data, "Montos obtenidos correctamente");
  } catch (e) { next(e); }
};

const editarMontos = async (req, res, next) => {
  try {
    const data = await service.editarMontos(req.params.id, req.params.eid, req.body, req.user);
    return successResponse(res, data, "MONTOS ACTUALIZADOS CORRECTAMENTE");
  } catch (e) { next(e); }
};

const exportExcel = async (req, res, next) => {
  try {
    const { buffer, filename } = await service.exportExcel(req.params.id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (e) { next(e); }
};

const exportBanco = async (req, res, next) => {
  try {
    const { content, filename } = await service.exportBanco(req.params.id);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  } catch (e) { next(e); }
};

module.exports = {
  list, getById, create, update, preview, generar, getDetalle,
  cerrar, reversar, reversarEmpleado, getMontos, editarMontos,
  exportExcel, exportBanco
};
