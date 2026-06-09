const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { upperCaseFields } = require("../utils/text");

const TIPOS_PERSONA = ["EMPLEADO", "JUBILADO"];
const ESTADOS = ["ACTIVO", "INACTIVO"];

const createError = (message, status = 400) => { const error = new Error(message); error.status = status; return error; };

const sql = (file) => getSql(`descuentos-judiciales/${file}.sql`);

const mapRow = (row) => ({
  id: row.dju_id,
  tipoManejo: row.dju_tipo_manejo,
  tipoPersona: row.dju_tipo_persona,
  idPersona: row.dju_id_persona,
  expediente: row.dju_expediente,
  juzgado: row.dju_juzgado,
  monto: Number(row.dju_monto),
  descripcion: row.dju_descripcion,
  estado: row.dju_estado,
  manejoDescripcion: row.manejo_descripcion,
  personaNombre: row.persona_nombre,
  fechaCreacion: row.dju_fecha_creacion,
  usuarioCreacion: row.dju_usuario_creacion
});

const toDb = (data) => [
  data.tipoManejo,
  data.tipoPersona,
  data.idPersona,
  data.expediente,
  data.juzgado,
  data.monto,
  data.descripcion || "",
  data.estado
];

const validate = (data) => {
  ["tipoManejo", "tipoPersona", "idPersona", "expediente", "juzgado", "monto", "estado"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") throw createError(`El campo ${field} es obligatorio`);
  });
  if (!TIPOS_PERSONA.includes(String(data.tipoPersona).toUpperCase())) throw createError("Tipo persona no permitido. Use: EMPLEADO, JUBILADO");
  if (!ESTADOS.includes(String(data.estado).toUpperCase())) throw createError("Estado no permitido. Use: ACTIVO, INACTIVO");
  if (Number(data.monto) <= 0) throw createError("El monto debe ser mayor a 0");
};

const normalize = (data) => upperCaseFields(data, ["tipoPersona", "expediente", "juzgado", "descripcion", "estado"]);

const list = async () => {
  const [rows] = await pool.execute(sql("listar"));
  return rows.map(mapRow);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Descuento judicial no encontrado", 404);
  return mapRow(rows[0]);
};

const create = async (payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(sql("crear"), [...toDb(data), createdBy]);
  logger.info("Descuento judicial creado", { id: result.insertId, createdBy });
  return getById(result.insertId);
};

const update = async (id, payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  await getById(id);
  await pool.execute(sql("actualizar"), [...toDb(data), id]);
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
