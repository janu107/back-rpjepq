const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const ExcelJS = require("exceljs");

const TIPO_PLANILLA_EMPLEADOS = 1;

const sql = (file) => getSql(`planillas-trabajadores/${file}.sql`);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toNum = (v) => Number(v || 0);

const mapPlanilla = (row) => ({
  id: row.id,
  tipoPlanilla: row.tipo_planilla,
  tipoPlanillaNombre: row.tipo_planilla_nombre,
  tipoPlanillaDescripcion: row.tipo_planilla_descripcion,
  numero: row.numero,
  fechaInicio: row.fecha_inicio,
  fechaFinal: row.fecha_final,
  fechaPago: row.fecha_pago,
  frecuencia: row.frecuencia,
  estado: row.estado,
  aplicaPorcentaje: Boolean(row.aplica_porcentaje),
  porcentajePago: toNum(row.porcentaje_pago),
  estadoProceso: row.estado_proceso || "ABIERTA",
  fechaGeneracion: row.fecha_generacion,
  fechaCierre: row.fecha_cierre,
  usuarioGenera: row.usuario_genera,
  usuarioCierra: row.usuario_cierra,
  fechaCreacion: row.fecha_creacion,
  usuarioCreacion: row.usuario_creacion,
  totalEmpleados: toNum(row.total_empleados),
  totalIngresos: toNum(row.total_ingresos),
  totalDescuentos: toNum(row.total_descuentos),
  netoPagar: toNum(row.neto_a_pagar)
});

const mapDetalle = (row) => ({
  idEmpleado: row.id_empleado,
  dpi: row.emp_dpi,
  nombreCompleto: row.nombre_completo,
  fechaIngreso: row.emp_fecha_ingreso,
  puesto: row.puesto,
  diasTrabajados: toNum(row.dias_trabajados),
  totalIngresos: toNum(row.total_ingresos),
  totalDescuentos: toNum(row.total_descuentos),
  netoPagar: toNum(row.neto_a_pagar),
  estadoPlanilla: row.estado_planilla
});

const validate = (data) => {
  if (!data.numero || String(data.numero).length !== 6) throw createError("El número de planilla debe tener formato YYYYMM");
  if (!data.fechaInicio) throw createError("La fecha de inicio es obligatoria");
  if (!data.fechaFinal) throw createError("La fecha final es obligatoria");
  if (!data.fechaPago) throw createError("La fecha de pago es obligatoria");
  if (data.fechaInicio > data.fechaFinal) throw createError("La fecha inicio no puede ser mayor a la fecha final");
  if (data.fechaFinal > data.fechaPago) throw createError("La fecha final no puede ser mayor a la fecha de pago");
  const pct = toNum(data.porcentajePago);
  if (pct <= 0 || pct > 100) throw createError("El porcentaje de pago debe estar entre 1 y 100");
};

const list = async () => {
  const [rows] = await pool.execute(sql("listar"));
  return rows.map(mapPlanilla);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Planilla no encontrada", 404);
  return mapPlanilla(rows[0]);
};

const create = async (payload, currentUser) => {
  validate(payload);
  // Evitar planillas duplicadas por tipo + numero (Version VII)
  const [dup] = await pool.execute(
    "SELECT ppl_correlativo FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = ? AND ppl_numero = ?",
    [TIPO_PLANILLA_EMPLEADOS, payload.numero]
  );
  if (dup.length) throw createError("YA EXISTE UNA PLANILLA DE EMPLEADOS CON ESE NUMERO", 409);
  const usuario = currentUser?.usuario || "sistema";
  const params = [
    TIPO_PLANILLA_EMPLEADOS, payload.numero,
    payload.fechaInicio, payload.fechaFinal, payload.fechaPago,
    toNum(payload.porcentajePago) || 100,
    usuario
  ];
  const [result] = await pool.execute(sql("crear"), params);
  return getById(result.insertId);
};

const update = async (id, payload, currentUser) => {
  const existing = await getById(id);
  if (existing.estadoProceso !== "ABIERTA") throw createError("Solo se pueden editar planillas en estado ABIERTA");
  const pct = toNum(payload.porcentajePago);
  if (pct <= 0 || pct > 100) throw createError("El porcentaje de pago debe estar entre 1 y 100");
  if (payload.fechaInicio > payload.fechaFinal) throw createError("La fecha inicio no puede ser mayor a la fecha final");
  if (payload.fechaFinal > payload.fechaPago) throw createError("La fecha final no puede ser mayor a la fecha de pago");
  await pool.execute(sql("actualizar"), [
    payload.numero, payload.fechaInicio, payload.fechaFinal, payload.fechaPago, pct, id
  ]);
  return getById(id);
};

const preview = async (id) => {
  const [rows] = await pool.execute(sql("preview"), [id]);
  if (!rows[0]) throw createError("Planilla no encontrada", 404);
  const row = rows[0];
  const totalActivos = toNum(row.total_activos);
  const conDatos = toNum(row.con_datos_planilla);
  return {
    totalActivos,
    conDatosPlanilla: conDatos,
    excluidos: totalActivos - conDatos,
    porcentajePago: toNum(row.porcentaje_pago),
    estadoProceso: row.estado_proceso
  };
};

// Igual que pensionados: protocolo de texto para CALL con variables de sesión,
// una sola conexion para que las variables @out persistan.
const callSp = async (spCall, inParams, outNames) => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CALL ${spCall}`, inParams);
    if (!outNames || outNames.length === 0) return {};
    const outSelect = outNames.map((n) => `@${n} AS ${n}`).join(", ");
    const [[outRow]] = await conn.query(`SELECT ${outSelect}`);
    return outRow;
  } finally {
    conn.release();
  }
};

const generar = async (id, currentUser) => {
  const planilla = await getById(id);
  if (planilla.estadoProceso !== "ABIERTA") throw createError("PLANILLA NO EN ESTADO ABIERTA. No se puede generar la nomina.");
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Generando nomina trabajadores", { idPlanilla: id, usuario });

  const out = await callSp(
    `sp_generar_nomina_trabajadores(?, ?, @p_proc, @p_excl, @p_pag, @p_desc)`,
    [id, usuario],
    ["p_proc", "p_excl", "p_pag", "p_desc"]
  );

  logger.info("Nomina trabajadores generada", { idPlanilla: id, ...out });
  return {
    procesados: toNum(out.p_proc),
    excluidos: toNum(out.p_excl),
    totalPagado: toNum(out.p_pag),
    totalDescuentos: toNum(out.p_desc),
    estadoNuevo: "GENERADA"
  };
};

const getDetalle = async (id) => {
  const [rows] = await pool.execute(sql("obtenerDetalle"), [id]);
  return rows.map(mapDetalle);
};

const cerrar = async (id, currentUser) => {
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Cerrando planilla trabajadores", { idPlanilla: id, usuario });
  await callSp(`sp_cerrar_planilla(?, ?)`, [id, usuario], []);
  return getById(id);
};

const reversar = async (id, motivo, currentUser) => {
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo de reverso es obligatorio");
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Reversando planilla trabajadores", { idPlanilla: id, usuario });
  await callSp(`sp_reversar_planilla_trabajadores(?, ?, ?)`, [id, usuario, motivo], []);
  return getById(id);
};

const reversarEmpleado = async (id, idEmpleado, motivo, currentUser) => {
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo de reverso es obligatorio");
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Reversando pago de empleado", { idPlanilla: id, idEmpleado, usuario });
  await callSp(`sp_reversar_pago_trabajador(?, ?, ?, ?)`, [id, idEmpleado, usuario, motivo], []);
  return getDetalle(id);
};

const exportExcel = async (id) => {
  const [planilla, detalle] = await Promise.all([getById(id), getDetalle(id)]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Nomina Empleados");

  ws.columns = [
    { header: "DPI",             key: "dpi",             width: 16 },
    { header: "Nombre Completo", key: "nombreCompleto",  width: 30 },
    { header: "Fecha Ingreso",   key: "fechaIngreso",    width: 16 },
    { header: "Puesto",          key: "puesto",          width: 22 },
    { header: "Días Trabajados", key: "diasTrabajados",  width: 14 },
    { header: "Total Ingresos",  key: "totalIngresos",   width: 16 },
    { header: "Descuentos",      key: "totalDescuentos", width: 16 },
    { header: "Neto a Pagar",    key: "netoPagar",       width: 16 }
  ];

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } };

  detalle.forEach((r) => ws.addRow(r));

  const tot = ws.addRow({
    nombreCompleto: "TOTAL",
    totalIngresos: detalle.reduce((s, r) => s + r.totalIngresos, 0),
    totalDescuentos: detalle.reduce((s, r) => s + r.totalDescuentos, 0),
    netoPagar: detalle.reduce((s, r) => s + r.netoPagar, 0)
  });
  tot.font = { bold: true };

  ws.properties.defaultRowHeight = 18;
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: buf, filename: `nomina_empleados_${planilla.numero}.xlsx` };
};

const exportBanco = async (id) => {
  const detalle = await getDetalle(id);
  const planilla = await getById(id);
  const lines = detalle.map((r) => {
    const nombre = (r.nombreCompleto || "").substring(0, 40).padEnd(40);
    const monto = r.netoPagar.toFixed(2);
    return `${(r.dpi || "")}|${nombre}|${monto}`;
  });
  return {
    content: lines.join("\n"),
    filename: `banco_empleados_${planilla.numero}.txt`
  };
};

module.exports = {
  list, getById, create, update, preview,
  generar, getDetalle, cerrar, reversar, reversarEmpleado,
  exportExcel, exportBanco
};
