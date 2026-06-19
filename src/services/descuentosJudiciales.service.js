const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { upperCaseFields } = require("../utils/text");

const ESTADOS = ["ACTIVO", "INACTIVO"];

const createError = (message, status = 400) => { const error = new Error(message); error.status = status; return error; };

const sql = (file) => getSql(`descuentos-judiciales/${file}.sql`);

const mapRow = (row) => ({
  id: row.dju_correlativo,
  tipoManejo: row.dju_tipo_manejo,
  idEmpleado: row.dju_id_empleado,
  idJubilado: row.dju_id_jubilado,
  idPersona: row.dju_id_empleado ?? row.dju_id_jubilado,
  beneficiario: row.dju_beneficiario,
  tipo: row.dju_tipo,
  valor: Number(row.dju_valor),
  saldo: Number(row.dju_saldo),
  fechaInicio: row.dju_fecha_inicio,
  fechaFinal: row.dju_fecha_final,
  estado: row.dju_estado,
  manejoDescripcion: row.manejo_descripcion,
  personaNombre: row.persona_nombre,
  fechaCreacion: row.dju_fecha_creacion,
  usuarioCreacion: row.dju_usuario_creacion
});

// Enruta el id de la persona a la columna correcta segun el tipo de manejo:
//   tipo_manejo = 2 (jubilado) -> dju_id_jubilado ; tipo_manejo = 1 -> dju_id_empleado
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
    data.beneficiario,
    data.tipo,
    data.valor,
    data.saldo || 0,
    data.fechaInicio,
    data.fechaFinal || null,
    data.estado
  ];
};

const validate = (data) => {
  ["tipoManejo", "idEmpleado", "beneficiario", "tipo", "valor", "fechaInicio", "estado"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") throw createError(`El campo ${field} es obligatorio`);
  });
  if (!ESTADOS.includes(String(data.estado).toUpperCase())) throw createError("Estado no permitido. Use: ACTIVO, INACTIVO");
  if (Number(data.valor) <= 0) throw createError("El valor debe ser mayor a 0");
};

const normalize = (data) => upperCaseFields(data, ["beneficiario", "tipo", "estado"]);

const list = async () => {
  const [rows] = await pool.execute(sql("listar"));
  return rows.map(mapRow);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Descuento judicial no encontrado", 404);
  return mapRow(rows[0]);
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

const create = async (payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  const createdBy = currentUser?.usuario || "sistema";
  const insertId = await withFkBypass(async (conn) => {
    const [result] = await conn.execute(sql("crear"), [...toDb(data), createdBy]);
    return result.insertId;
  });
  logger.info("Descuento judicial creado", { id: insertId, createdBy });
  return getById(insertId);
};

const update = async (id, payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  await getById(id);
  await withFkBypass(async (conn) => {
    await conn.execute(sql("actualizar"), [...toDb(data), id]);
  });
  logger.info("Descuento judicial actualizado", { id, updatedBy: currentUser?.usuario });
  return getById(id);
};

const remove = async (id, currentUser) => {
  await getById(id);
  await pool.execute(sql("eliminar"), [id]);
  logger.info("Descuento judicial eliminado", { id, deletedBy: currentUser?.usuario });
  return { id: Number(id) };
};

module.exports = { list, getById, create, update, remove };
