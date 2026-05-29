const ExcelJS = require("exceljs");
const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const aportacionesService = require("./aportaciones.service");

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

// ---- Carga masiva por Excel (Version IV) -------------------------------------
// Encabezados aceptados (normalizados: minusculas, sin acentos, espacios colapsados).
const HEADER_MATCHERS = [
  { key: "idEmpleado", aliases: ["id empleado", "idempleado", "id_empleado", "id aportacion", "idaportacion", "id_aportacion", "codigo empleado", "codigo", "empleado"] },
  { key: "fecha", aliases: ["fecha", "fecha pago", "fecha_pago", "fechapago"] },
  { key: "monto", aliases: ["monto", "valor", "cantidad", "aporte"] }
];

const normalizeHeader = (value) =>
  String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

// exceljs devuelve distintos tipos de celda (Date, formula, richText, hyperlink...).
const cellToValue = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if (value.text !== undefined) return value.text;
    if (value.result !== undefined) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  }
  return value;
};

const pad = (value) => String(value).padStart(2, "0");

const toDateString = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const str = String(value ?? "").trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dmy = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`;
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

/**
 * Carga masiva de aportaciones (detalle) desde un Excel (Version IV).
 * Columnas esperadas: id empleado, fecha, monto (se aceptan variantes de encabezado).
 * Reglas:
 *  - "id empleado" corresponde a RPJ_MNT_APORTACION_EPQ.apo_id; se usa su apo_correlativo.
 *  - SOLO inserta registros nuevos; nunca actualiza existentes.
 *  - Si ya existe un detalle para la misma aportacion y misma fecha, se omite (duplicado).
 *  - Devuelve un resumen con totales y errores por fila.
 */
const bulkUpload = async (buffer, currentUser) => {
  if (!buffer || !buffer.length) throw createError("No se recibio ningun archivo o esta vacio");

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    throw createError("El archivo no es un Excel valido (.xlsx)");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) throw createError("El archivo no contiene datos");

  // Mapear encabezados de la fila 1 a indices de columna.
  const columnIndex = {};
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const header = normalizeHeader(cellToValue(cell.value));
    HEADER_MATCHERS.forEach((matcher) => {
      if (columnIndex[matcher.key] === undefined && matcher.aliases.includes(header)) {
        columnIndex[matcher.key] = colNumber;
      }
    });
  });

  const missing = HEADER_MATCHERS.filter((matcher) => columnIndex[matcher.key] === undefined).map((matcher) => matcher.key);
  if (missing.length > 0) {
    throw createError("El Excel debe contener las columnas: ID EMPLEADO, FECHA, MONTO");
  }

  const createdBy = currentUser?.usuario || "sistema";
  const summary = { totalFilas: 0, insertados: 0, omitidos: 0, errores: [] };

  // Cache de aportaciones por apo_id para evitar consultas repetidas.
  const aportacionCache = new Map();
  const findAportacion = async (apoId) => {
    if (aportacionCache.has(apoId)) return aportacionCache.get(apoId);
    const [rows] = await pool.execute(getSql("aportaciones/buscarPorIdAportacion.sql"), [apoId]);
    const correlativo = rows[0] ? Number(rows[0].apo_correlativo) : null;
    aportacionCache.set(apoId, correlativo);
    return correlativo;
  };

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rawId = cellToValue(row.getCell(columnIndex.idEmpleado).value);
    const rawFecha = cellToValue(row.getCell(columnIndex.fecha).value);
    const rawMonto = cellToValue(row.getCell(columnIndex.monto).value);

    // Ignorar filas completamente vacias (no cuentan como error).
    if ([rawId, rawFecha, rawMonto].every((value) => String(value ?? "").trim() === "")) continue;

    summary.totalFilas += 1;
    const idEmpleado = String(rawId ?? "").trim();
    const fecha = toDateString(rawFecha);
    const monto = Number(rawMonto);

    if (!idEmpleado) { summary.errores.push({ fila: rowNumber, error: "ID empleado es obligatorio" }); continue; }
    if (!fecha) { summary.errores.push({ fila: rowNumber, error: "Fecha invalida" }); continue; }
    if (!(monto > 0)) { summary.errores.push({ fila: rowNumber, error: "Monto debe ser numerico y mayor a 0" }); continue; }

    try {
      const aportacionCorrelativo = await findAportacion(idEmpleado);
      if (!aportacionCorrelativo) {
        summary.errores.push({ fila: rowNumber, error: `No existe aportacion con ID ${idEmpleado}` });
        continue;
      }

      // No actualizar: si ya existe detalle para misma aportacion y misma fecha, se omite.
      const [existing] = await pool.execute(getSql("aportaciones/detalle/buscarPorAportacionYFecha.sql"), [aportacionCorrelativo, fecha]);
      if (existing.length > 0) { summary.omitidos += 1; continue; }

      await pool.execute(getSql("aportaciones/detalle/crearDetalle.sql"), [aportacionCorrelativo, fecha, monto, createdBy]);
      summary.insertados += 1;
    } catch (error) {
      logger.error("Error en fila de carga masiva", { fila: rowNumber, message: error.message, code: error.code });
      summary.errores.push({ fila: rowNumber, error: "No se pudo procesar la fila" });
    }
  }

  logger.info("Carga masiva de aportaciones procesada", {
    totalFilas: summary.totalFilas,
    insertados: summary.insertados,
    omitidos: summary.omitidos,
    errores: summary.errores.length,
    createdBy
  });
  return summary;
};

module.exports = { listByAportacion, createDetalle, updateDetalle, removeDetalle, getTotal, bulkUpload };
