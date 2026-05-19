const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const aportacionesService = require("./aportaciones.service");

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const validatePayload = (data) => {
  if (!data.fechaPago || Number.isNaN(Date.parse(data.fechaPago))) {
    throw createError("Fecha de pago invalida");
  }
  if (Number(data.valor) <= 0) {
    throw createError("El valor debe ser mayor a 0");
  }
};

const mapDetalle = (row) => ({
  id: row.dap_correlativo,
  idAportacion: row.dap_id_aportacion,
  codigoEmpleado: row.apo_id,
  nombre: `${row.apo_nombre || ""} ${row.apo_apellido || ""}`.trim(),
  fechaPago: row.dap_fecha_pago,
  valor: Number(row.dap_valor),
  fechaCreacion: row.dap_fecha_creacion,
  usuarioCreacion: row.dap_usuario_creacion
});

const listByAportacion = async (aportacionId) => {
  await aportacionesService.getById(aportacionId);
  logger.info("Detalle de aportacion solicitado", { aportacionId });
  const [rows] = await pool.execute(getSql("aportaciones/detalle/listarPorAportacion.sql"), [aportacionId]);
  return rows.map(mapDetalle);
};

const getDetalleById = async (detalleId) => {
  const [rows] = await pool.execute(getSql("aportaciones/detalle/obtenerDetallePorId.sql"), [detalleId]);
  if (!rows[0]) throw createError("Detalle de aportacion no encontrado", 404);
  return mapDetalle(rows[0]);
};

const createDetalle = async (aportacionId, payload, currentUser) => {
  validatePayload(payload);
  await aportacionesService.getById(aportacionId);
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(getSql("aportaciones/detalle/crearDetalle.sql"), [
    aportacionId,
    payload.fechaPago,
    payload.valor,
    createdBy
  ]);
  logger.info("Detalle de aportacion creado", { id: result.insertId, aportacionId, createdBy });
  return getDetalleById(result.insertId);
};

const updateDetalle = async (detalleId, payload, currentUser) => {
  validatePayload(payload);
  await getDetalleById(detalleId);
  await pool.execute(getSql("aportaciones/detalle/actualizarDetalle.sql"), [payload.fechaPago, payload.valor, detalleId]);
  logger.info("Detalle de aportacion actualizado", { detalleId, updatedBy: currentUser?.usuario });
  return getDetalleById(detalleId);
};

const removeDetalle = async (detalleId, currentUser) => {
  await getDetalleById(detalleId);
  await pool.execute(getSql("aportaciones/detalle/eliminarDetalle.sql"), [detalleId]);
  logger.info("Detalle de aportacion eliminado", { detalleId, deletedBy: currentUser?.usuario });
  return { id: Number(detalleId) };
};

const getTotal = async (aportacionId) => {
  await aportacionesService.getById(aportacionId);
  const [rows] = await pool.execute(getSql("aportaciones/detalle/totalAportado.sql"), [aportacionId]);
  return { idAportacion: Number(aportacionId), totalAportado: Number(rows[0]?.total_aportado || 0) };
};

module.exports = { listByAportacion, createDetalle, updateDetalle, removeDetalle, getTotal };
