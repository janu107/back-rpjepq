const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const prestamosService = require("./prestamos.service");

const createError = (message, status = 400) => { const error = new Error(message); error.status = status; return error; };

const mapDetalle = (row) => ({
  id: row.dpr_correlativo,
  idPrestamo: row.dpr_id_prestamo,
  fechaPago: row.dpr_fecha_pago,
  descuentoNominaAportacion: Number(row.dpr_descuento_nomina_aportacion),
  cuotaNivelada: Number(row.dpr_cuota_nivelada),
  amortizacion: Number(row.dpr_amortizacion),
  intereses: Number(row.dpr_intereses),
  saldo: Number(row.dpr_saldo),
  mora: Number(row.dpr_mora),
  seguro: Number(row.dpr_seguro || 0),
  fechaCreacion: row.dpr_fecha_creacion,
  usuarioCreacion: row.dpr_usuario_creacion
});

const validatePayload = (data) => {
  if (!data.fechaPago || Number.isNaN(Date.parse(data.fechaPago))) throw createError("Fecha de pago invalida");
  ["descuentoNominaAportacion", "cuotaNivelada", "amortizacion", "intereses", "saldo", "mora", "seguro"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || Number(data[field]) < 0) throw createError(`El campo ${field} no puede ser negativo`);
  });
};

const toDb = (data) => [data.fechaPago, data.descuentoNominaAportacion, data.cuotaNivelada, data.amortizacion, data.intereses, data.saldo, data.mora, data.seguro || 0];

const listByPrestamo = async (prestamoId) => {
  await prestamosService.getById(prestamoId);
  const [rows] = await pool.execute(getSql("prestamos/detalle/listarPorPrestamo.sql"), [prestamoId]);
  return rows.map(mapDetalle);
};

const getDetalleById = async (detalleId) => {
  const [rows] = await pool.execute(getSql("prestamos/detalle/obtenerDetallePorId.sql"), [detalleId]);
  if (!rows[0]) throw createError("Detalle de prestamo no encontrado", 404);
  return mapDetalle(rows[0]);
};

const createDetalle = async (prestamoId, payload, currentUser) => {
  validatePayload(payload);
  await prestamosService.getById(prestamoId);
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(getSql("prestamos/detalle/crearDetalle.sql"), [prestamoId, ...toDb(payload), createdBy]);
  logger.info("Detalle de prestamo creado", { id: result.insertId, prestamoId, createdBy });
  return getDetalleById(result.insertId);
};

const updateDetalle = async (detalleId, payload, currentUser) => {
  validatePayload(payload);
  await getDetalleById(detalleId);
  await pool.execute(getSql("prestamos/detalle/actualizarDetalle.sql"), [...toDb(payload), detalleId]);
  logger.info("Detalle de prestamo actualizado", { detalleId, updatedBy: currentUser?.usuario });
  return getDetalleById(detalleId);
};

const removeDetalle = async (detalleId, currentUser) => {
  await getDetalleById(detalleId);
  await pool.execute(getSql("prestamos/detalle/eliminarDetalle.sql"), [detalleId]);
  logger.info("Detalle de prestamo eliminado", { detalleId, deletedBy: currentUser?.usuario });
  return { id: Number(detalleId) };
};

const getSaldo = async (prestamoId) => {
  const prestamo = await prestamosService.getById(prestamoId);
  const [rows] = await pool.execute(getSql("prestamos/detalle/obtenerSaldoActual.sql"), [prestamoId]);
  const saldo = rows[0] ? Number(rows[0].saldo_actual) : Number(prestamo.montoAutorizado);
  return { idPrestamo: Number(prestamoId), saldoActual: saldo };
};

const getTotalPagado = async (prestamoId) => {
  await prestamosService.getById(prestamoId);
  const [rows] = await pool.execute(getSql("prestamos/detalle/totalPagado.sql"), [prestamoId]);
  return { idPrestamo: Number(prestamoId), totalPagado: Number(rows[0]?.total_pagado || 0) };
};

module.exports = { listByPrestamo, createDetalle, updateDetalle, removeDetalle, getSaldo, getTotalPagado };
