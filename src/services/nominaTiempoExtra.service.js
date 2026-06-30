const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

// Nómina de Tiempo Extra (planilla tipo 3). Toda la lógica de cálculo vive en el
// SP sp_generar_nomina_tiempo_extra; aquí solo se listan/crean planillas tipo 3,
// se invoca el SP y se consulta el resumen por empleado.

const TIPO_PLANILLA = 3;
const sql = (file) => getSql(`nomina-tiempo-extra/${file}.sql`);
const num = (v) => Number(v || 0);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const mapPlanilla = (r) => ({
  id: r.id,
  tipoPlanilla: r.tipo_planilla,
  tipoPlanillaNombre: r.tipo_planilla_nombre || "NOMINA TIEMPO EXTRA",
  numero: r.numero,
  fechaInicio: r.fecha_inicio,
  fechaFinal: r.fecha_final,
  fechaPago: r.fecha_pago,
  estadoProceso: r.estado_proceso || "ABIERTA",
  fechaGeneracion: r.fecha_generacion,
  usuarioGenera: r.usuario_genera,
  totalEmpleados: num(r.total_empleados),
  totalIngresos: num(r.total_ingresos),
  totalDescuentos: num(r.total_descuentos),
  netoPagar: num(r.neto_a_pagar)
});

const mapDetalle = (r) => ({
  idEmpleado: r.id_empleado,
  dpi: r.dpi,
  nombreCompleto: r.nombre_completo,
  puesto: r.puesto,
  horas: num(r.horas),
  totalIngresos: num(r.total_ingresos),
  totalDescuentos: num(r.total_descuentos),
  netoPagar: num(r.neto_a_pagar)
});

const list = async () => {
  const [rows] = await pool.execute(sql("listar"));
  return rows.map(mapPlanilla);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Planilla no encontrada", 404);
  return mapPlanilla(rows[0]);
};

const validate = (d) => {
  if (!d.numero || String(d.numero).length !== 6) throw createError("El número de planilla debe tener formato YYYYMM");
  if (!d.fechaInicio || !d.fechaFinal || !d.fechaPago) throw createError("Las fechas son obligatorias");
  if (d.fechaInicio > d.fechaFinal) throw createError("La fecha inicio no puede ser mayor a la final");
  if (d.fechaFinal > d.fechaPago) throw createError("La fecha final no puede ser mayor a la fecha de pago");
};

const create = async (payload, currentUser) => {
  validate(payload);
  const [dup] = await pool.execute(
    "SELECT ppl_correlativo FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = ? AND ppl_numero = ?",
    [TIPO_PLANILLA, payload.numero]
  );
  if (dup.length) throw createError("YA EXISTE UNA PLANILLA DE TIEMPO EXTRA CON ESE NUMERO", 409);
  const usuario = currentUser?.usuario || "sistema";
  const [res] = await pool.execute(sql("crear"), [
    payload.numero, payload.fechaInicio, payload.fechaFinal, payload.fechaPago, usuario
  ]);
  return getById(res.insertId);
};

// CALL con variable de sesión @p_resultado en una sola conexión.
const callSp = async (spCall, inParams, outNames) => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CALL ${spCall}`, inParams);
    const outSelect = outNames.map((n) => `@${n} AS ${n}`).join(", ");
    const [[outRow]] = await conn.query(`SELECT ${outSelect}`);
    return outRow;
  } finally {
    conn.release();
  }
};

const generar = async (id, currentUser) => {
  await getById(id);
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Generando nomina tiempo extra", { idPlanilla: id, usuario });
  const out = await callSp(`sp_generar_nomina_tiempo_extra(?, ?, @p_resultado)`, [id, usuario], ["p_resultado"]);
  const resultado = out.p_resultado || "";
  if (String(resultado).toUpperCase().includes("ERROR")) throw createError(resultado, 409);
  logger.info("Nomina tiempo extra generada", { idPlanilla: id, resultado });
  return { resultado, planilla: await getById(id) };
};

const getDetalle = async (id) => {
  const [rows] = await pool.execute(sql("detalle"), [id, id]);
  return rows.map(mapDetalle);
};

module.exports = { list, getById, create, generar, getDetalle };
