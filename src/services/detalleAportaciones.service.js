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
  const summary = { totalFilas: 0, insertados: 0, omitidos: 0, sumados: 0, fecha: null, errores: [] };

  // 1) Leer y validar todas las filas.
  const filas = [];
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
    const monto = Math.round(Number(rawMonto) * 100) / 100;

    if (!idEmpleado) { summary.errores.push({ fila: rowNumber, error: "ID empleado es obligatorio" }); continue; }
    if (!fecha) { summary.errores.push({ fila: rowNumber, error: "Fecha invalida" }); continue; }
    if (!(monto > 0)) { summary.errores.push({ fila: rowNumber, error: "Monto debe ser numerico y mayor a 0" }); continue; }
    filas.push({ rowNumber, idEmpleado, fecha, monto });
  }

  // Un archivo = un período: todas las filas deben tener la misma fecha de pago.
  const fechasArchivo = [...new Set(filas.map((f) => f.fecha))].sort();
  if (fechasArchivo.length > 1) {
    const muestra = fechasArchivo.slice(0, 5).map((f) => f.split("-").reverse().join("/")).join(", ");
    throw createError(`El archivo debe ser de un solo período (una sola fecha de pago) y trae ${fechasArchivo.length} fechas: ${muestra}${fechasArchivo.length > 5 ? "…" : ""}. No se grabó nada.`);
  }
  summary.fecha = fechasArchivo[0] || null;

  if (filas.length) {
    // 2) Empleados EPQ de todo el archivo en una sola consulta (apo_id -> apo_correlativo).
    const ids = [...new Set(filas.map((f) => f.idEmpleado))];
    const correlativo = new Map();
    for (let k = 0; k < ids.length; k += 1000) {
      const [rows] = await pool.query("SELECT apo_correlativo, apo_id FROM RPJ_MNT_APORTACION_EPQ WHERE apo_id IN (?)", [ids.slice(k, k + 1000)]);
      rows.forEach((r) => correlativo.set(String(r.apo_id), Number(r.apo_correlativo)));
    }

    // 3) Aportes que ya existen (mismo empleado y misma fecha) en el rango de fechas del archivo.
    const correlativos = [...new Set([...correlativo.values()])];
    const fechas = filas.map((f) => f.fecha).sort();
    const existentes = new Set();
    for (let k = 0; k < correlativos.length; k += 1000) {
      const [rows] = await pool.query(
        `SELECT dap_id_aportacion AS id, DATE_FORMAT(dap_fecha_pago, '%Y-%m-%d') AS fecha
           FROM RPJ_MNT_DETALLE_APORTACION_EPQ
          WHERE dap_id_aportacion IN (?) AND dap_fecha_pago BETWEEN ? AND ?`,
        [correlativos.slice(k, k + 1000), fechas[0], fechas[fechas.length - 1]]
      );
      rows.forEach((r) => existentes.add(`${r.id}|${r.fecha}`));
    }

    // 4) Un aporte por empleado: si el código viene varias veces se suman sus montos.
    //    Si ya tiene aporte en esa fecha (período ya cargado), se omite el empleado.
    const porEmpleado = new Map();
    filas.forEach((f) => {
      const id = correlativo.get(f.idEmpleado);
      if (!id) { summary.errores.push({ fila: f.rowNumber, error: `No existe aportacion con ID ${f.idEmpleado}` }); return; }
      const actual = porEmpleado.get(id);
      if (actual) { actual.monto = Math.round((actual.monto + f.monto) * 100) / 100; summary.sumados += 1; }
      else porEmpleado.set(id, { id, fecha: f.fecha, monto: f.monto });
    });
    const nuevos = [];
    porEmpleado.forEach((a) => {
      if (existentes.has(`${a.id}|${a.fecha}`)) { summary.omitidos += 1; return; }
      nuevos.push([a.id, a.fecha, a.monto, createdBy]);
    });

    // 5) Guardar de 1,000 en 1,000 en una sola transacción: o entra todo o nada.
    if (nuevos.length) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (let k = 0; k < nuevos.length; k += 1000) {
          await conn.query(
            "INSERT INTO RPJ_MNT_DETALLE_APORTACION_EPQ (dap_id_aportacion, dap_fecha_pago, dap_valor, dap_usuario_creacion) VALUES ?",
            [nuevos.slice(k, k + 1000)]
          );
        }
        await conn.commit();
        summary.insertados = nuevos.length;
      } catch (error) {
        await conn.rollback();
        logger.error("Carga masiva de aportaciones: no se guardó nada", { message: error.message, code: error.code });
        throw createError("No se pudo guardar la carga; no se agregó ningún registro. Intente de nuevo.", 500);
      } finally {
        conn.release();
      }
    }
  }
  summary.errores.sort((a, b) => a.fila - b.fila);

  logger.info("Carga masiva de aportaciones procesada", {
    totalFilas: summary.totalFilas,
    insertados: summary.insertados,
    omitidos: summary.omitidos,
    errores: summary.errores.length,
    createdBy
  });
  return summary;
};

// Plantilla de la carga masiva. La hoja 1 (la que se lee) va solo con los encabezados,
// para que nunca se suban ejemplos por error; el ejemplo y las reglas van en la hoja 2.
const plantillaCarga = async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RPJEPQ";
  const ws = wb.addWorksheet("Aportaciones");
  ws.columns = [{ header: "ID EMPLEADO", width: 16 }, { header: "FECHA", width: 14 }, { header: "MONTO", width: 14 }];
  const enc = ws.getRow(1);
  enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  enc.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E5F" } }; c.alignment = { horizontal: "center" }; });
  ws.getColumn(2).numFmt = "dd/mm/yyyy";
  ws.getColumn(3).numFmt = "#,##0.00";

  const inst = wb.addWorksheet("Instrucciones");
  inst.getColumn(1).width = 16; inst.getColumn(2).width = 14; inst.getColumn(3).width = 14; inst.getColumn(4).width = 70;
  const lineas = [
    ["CARGA MASIVA DE APORTACIONES EPQ"],
    [],
    ["Reglas"],
    ["1. Llene la hoja \"Aportaciones\" (la primera). No cambie los encabezados de la fila 1."],
    ["2. ID EMPLEADO: el código del empleado EPQ (el mismo de Mantenimiento EPQ › Empleados EPQ)."],
    ["3. FECHA: la fecha de pago del período (por ejemplo el último día del mes). TODAS las filas deben tener la MISMA fecha: un archivo = un período."],
    ["4. MONTO: el valor del aporte, mayor a cero, sin la letra Q (por ejemplo 250.50)."],
    ["5. Si un código viene varias veces, sus montos se SUMAN en un solo aporte. Las filas vacías se ignoran."],
    ["6. Si el empleado ya tiene aporte en esa fecha (período ya cargado), se omite; los demás sí se graban."],
    ["7. Archivo .xlsx de máximo 5 MB. Al terminar el sistema muestra cuántas filas se agregaron, se omitieron y cuáles tuvieron error."],
    [],
    ["Ejemplo (así deben verse las filas en la hoja \"Aportaciones\")"]
  ];
  lineas.forEach((l) => inst.addRow(l));
  inst.getRow(1).font = { bold: true, size: 13 };
  inst.getRow(3).font = { bold: true };
  inst.getRow(12).font = { bold: true };
  const ej = inst.addRow(["ID EMPLEADO", "FECHA", "MONTO"]);
  ej.font = { bold: true, color: { argb: "FFFFFFFF" } };
  [1, 2, 3].forEach((i) => { ej.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E5F" } }; });
  [[1234, new Date(Date.UTC(2026, 10, 30)), 250.5], [5678, new Date(Date.UTC(2026, 10, 30)), 310], [5678, new Date(Date.UTC(2026, 10, 30)), 40]]
    .forEach((r) => { const x = inst.addRow(r); x.getCell(2).numFmt = "dd/mm/yyyy"; x.getCell(3).numFmt = "#,##0.00"; });
  inst.addRow([]);
  inst.addRow(["Resultado: se graban 2 aportes con fecha 30/11/2026: el 1234 por Q250.50 y el 5678 por Q350.00 (310 + 40)."]);
  return { buffer: await wb.xlsx.writeBuffer(), filename: "plantilla_carga_aportaciones.xlsx" };
};

module.exports = { listByAportacion, createDetalle, updateDetalle, removeDetalle, getTotal, bulkUpload, plantillaCarga };
