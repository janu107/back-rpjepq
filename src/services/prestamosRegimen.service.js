const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { upperCaseFields } = require("../utils/text");

const ESTADOS = ["ACTIVO", "INACTIVO", "CANCELADO"];

const createError = (message, status = 400) => { const error = new Error(message); error.status = status; return error; };

const sql = (file) => getSql(`prestamos-regimen/${file}.sql`);

const mapRow = (row) => ({
  id: row.prr_correlativo,
  tipoManejo: row.prr_tipo_manejo,
  idEmpleado: row.prr_id_empleado,
  idJubilado: row.prr_id_jubilado,
  // idPersona: id unificado, sea empleado o jubilado (lo que el front usa)
  idPersona: row.prr_id_empleado ?? row.prr_id_jubilado,
  idBanco: row.prr_id_banco,
  noReferencia: row.prr_no_referencia,
  monto: Number(row.prr_monto),
  valorMes: Number(row.prr_valor_mes),
  saldo: Number(row.prr_saldo),
  noCuotas: row.prr_no_cuotas,
  fechaInicio: row.prr_fecha_inicio,
  fechaFin: row.prr_fecha_fin,
  uso: row.prr_uso,
  estado: row.prr_estado,
  manejoDescripcion: row.manejo_descripcion,
  bancoNombre: row.banco_nombre,
  personaNombre: row.persona_nombre,
  fechaCreacion: row.prr_fecha_creacion,
  usuarioCreacion: row.prr_usuario_creacion
});

// Enruta el id de la persona a la columna correcta segun el tipo de manejo:
//   tipo_manejo = 2 (jubilado) -> prr_id_jubilado ; tipo_manejo = 1 -> prr_id_empleado
const splitPersona = (data) => {
  const esJubilado = Number(data.tipoManejo) === 2;
  return {
    idEmpleado: esJubilado ? null : data.idEmpleado,
    idJubilado: esJubilado ? data.idEmpleado : null
  };
};

const toDb = (data) => {
  const persona = splitPersona(data);
  return [
  data.tipoManejo,
  persona.idEmpleado,
  persona.idJubilado,
  data.idBanco,
  data.noReferencia,
  data.monto,
  data.valorMes,
  data.saldo || 0,
  data.noCuotas,
  data.fechaInicio,
  data.fechaFin,
  data.uso || null,
  data.estado
  ];
};

const validate = (data) => {
  ["tipoManejo", "idEmpleado", "idBanco", "noReferencia", "monto", "valorMes", "noCuotas", "fechaInicio", "fechaFin", "estado"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") throw createError(`El campo ${field} es obligatorio`);
  });
  if (!ESTADOS.includes(String(data.estado).toUpperCase())) throw createError("Estado no permitido. Use: ACTIVO, INACTIVO, CANCELADO");
};

const normalize = (data) => upperCaseFields(data, ["noReferencia", "estado", "uso"]);

const ensureUniqueReferencia = async (noReferencia, excludeId = null) => {
  const [rows] = await pool.execute(sql("buscarPorReferencia"), [noReferencia]);
  if (rows.some((row) => Number(row.prr_correlativo) !== Number(excludeId))) throw createError("Ya existe un préstamo con ese número de referencia", 409);
};

const withFkBypass = async (fn) => {
  const conn = await pool.getConnection();
  try {
    await conn.execute("SET FOREIGN_KEY_CHECKS=0");
    const result = await fn(conn);
    await conn.execute("SET FOREIGN_KEY_CHECKS=1");
    conn.release();
    return result;
  } catch (err) {
    await conn.execute("SET FOREIGN_KEY_CHECKS=1").catch(() => {});
    conn.release();
    throw err;
  }
};

const list = async () => {
  const [rows] = await pool.execute(sql("listar"));
  return rows.map(mapRow);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Préstamo régimen no encontrado", 404);
  return mapRow(rows[0]);
};

const create = async (payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  await ensureUniqueReferencia(data.noReferencia);
  const createdBy = currentUser?.usuario || "sistema";
  const insertId = await withFkBypass(async (conn) => {
    const [result] = await conn.execute(sql("crear"), [...toDb(data), createdBy]);
    return result.insertId;
  });
  logger.info("Préstamo régimen creado", { id: insertId, createdBy });
  return getById(insertId);
};

const update = async (id, payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  await getById(id);
  await ensureUniqueReferencia(data.noReferencia, id);
  await withFkBypass(async (conn) => {
    await conn.execute(sql("actualizar"), [...toDb(data), id]);
  });
  logger.info("Préstamo régimen actualizado", { id, updatedBy: currentUser?.usuario });
  return getById(id);
};

const remove = async (id, currentUser) => {
  await getById(id);
  await pool.execute(sql("eliminar"), [id]);
  logger.info("Préstamo régimen eliminado", { id, deletedBy: currentUser?.usuario });
  return { id: Number(id) };
};

module.exports = { list, getById, create, update, remove };
