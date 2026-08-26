const service = require("../services/prestaciones.service");
const { successResponse } = require("../utils/response");

const list = async (req, res, next) => { try { return successResponse(res, await service.list(req.params.tipo), "Planillas de prestaciones listadas correctamente"); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { return successResponse(res, await service.create(req.params.tipo, req.body, req.user), "Planilla creada correctamente", 201); } catch (error) { next(error); } };
const preview = async (req, res, next) => { try { return successResponse(res, await service.preview(req.params.tipo, req.query), "Previsualización obtenida correctamente"); } catch (error) { next(error); } };
const generar = async (req, res, next) => { try { return successResponse(res, await service.generar(req.params.tipo, req.body, req.user), "Prestación generada correctamente"); } catch (error) { next(error); } };
const revertir = async (req, res, next) => { try { return successResponse(res, await service.revertir(req.params.tipo, req.params.id, req.body.motivo, req.user), "PRESTACIÓN REVERSADA CORRECTAMENTE"); } catch (error) { next(error); } };

const getById = async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id), "Planilla obtenida correctamente"); } catch (error) { next(error); } };
const getDetalle = async (req, res, next) => { try { return successResponse(res, await service.getDetalle(req.params.id), "Detalle obtenido correctamente"); } catch (error) { next(error); } };
const getEmpleadosDisponibles = async (req, res, next) => { try { return successResponse(res, await service.getEmpleadosDisponibles(req.params.id), "Empleados disponibles obtenidos correctamente"); } catch (error) { next(error); } };
const cerrar = async (req, res, next) => { try { return successResponse(res, await service.cerrar(req.params.id, req.user), "PLANILLA CERRADA CORRECTAMENTE"); } catch (error) { next(error); } };

const editarMonto = async (req, res, next) => { try { return successResponse(res, await service.editarMonto(req.params.idLinea, req.body.monto, req.user), "Monto actualizado correctamente"); } catch (error) { next(error); } };
const agregarEmpleado = async (req, res, next) => { try { return successResponse(res, await service.agregarEmpleado(req.params.id, req.body, req.user), "Empleado agregado correctamente", 201); } catch (error) { next(error); } };
const eliminarLinea = async (req, res, next) => { try { return successResponse(res, await service.eliminarLinea(req.params.idLinea, req.body?.motivo || req.query?.motivo, req.user), "Renglón eliminado correctamente"); } catch (error) { next(error); } };

const getExcluidosVacacional = async (req, res, next) => { try { return successResponse(res, await service.getExcluidosVacacional(req.query), "Empleados excluidos obtenidos correctamente"); } catch (error) { next(error); } };
const getResumenAnual = async (req, res, next) => { try { return successResponse(res, await service.getResumenAnual(), "Resumen anual obtenido correctamente"); } catch (error) { next(error); } };

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

module.exports = {
  list,
  create,
  preview,
  generar,
  revertir,
  getById,
  getDetalle,
  getEmpleadosDisponibles,
  cerrar,
  editarMonto,
  agregarEmpleado,
  eliminarLinea,
  getExcluidosVacacional,
  getResumenAnual,
  exportExcel,
  exportBanco
};
