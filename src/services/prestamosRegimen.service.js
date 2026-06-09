const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { upperCaseFields } = require("../utils/text");

const TIPOS_PERSONA = ["EMPLEADO", "JUBILADO"];
const ESTADOS = ["ACTIVO", "INACTIVO", "CANCELADO"];

const createError = (message, status = 400) => { const error = new Error(message); error.status = status; return error; };

const sql = (file) => getSql(`prestamos-regimen/${file}.sql`);

const mapRow = (row) => ({
  id: row.prr_id,
  tipoManejo: row.prr_tipo_manejo,
  tipoPersona: row.prr_tipo_persona,
  idPersona: row.prr_id_persona,
  idBanco: row.prr_id_banco,
  noContrato: row.prr_no_contrato,
  monto: Number(row.prr_monto),
  cuota: Number(row.prr_cuota),
  plazoMeses: row.prr_plazo_meses,
  fechaInicio: row.prr_fecha_inicio,
  fechaFin: row.prr_fecha_fin,
  tasaInteres: Number(row.prr_tasa_interes),
  estado: row.prr_estado,
  observaciones: row.prr_observaciones,
  manejoDescripcion: row.manejo_descripcion,
  bancoNombre: row.banco_nombre,
  personaNombre: row.persona_nombre,
  fechaCreacion: row.prr_fecha_creacion,
  usuarioCreacion: row.prr_usuario_creacion
});

const toDb = (data) => [
  data.tipoManejo,
  data.tipoPersona,
  data.idPersona,
  data.idBanco,
  data.noContrato,
  data.monto,
  data.cuota,
  data.plazoMeses,
  data.fechaInicio,
  data.fechaFin,
  data.tasaInteres || 0,
  data.estado,
  data.observaciones || ""
];

const validate = (data) => {
  ["tipoManejo", "tipoPersona", "idPersona", "idBanco", "noContrato", "monto", "cuota", "plazoMeses", "fechaInicio", "fechaFin", "estado"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") throw createError(`El campo ${field} es obligatorio`);
  });
  if (!TIPOS_PERSONA.includes(String(data.tipoPersona).toUpperCase())) throw createError("Tipo persona no permitido. Use: EMPLEADO, JUBILADO");
  if (!ESTADOS.includes(String(data.estado).toUpperCase())) throw createError("Estado no permitido. Use: ACTIVO, INACTIVO, CANCELADO");
};

const normalize = (data) => upperCaseFields(data, ["tipoPersona", "noContrato", "estado", "observaciones"]);

const ensureUniqueContrato = async (noContrato, excludeId = null) => {
  const [rows] = await pool.execute(sql("buscarPorContrato"), [noContrato]);
  if (rows.some((row) => Number(row.prr_id) !== Number(excludeId))) throw createError("Ya existe un préstamo con ese número de contrato", 409);
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
  await ensureUniqueContrato(data.noContrato);
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(sql("crear"), [...toDb(data), createdBy]);
  logger.info("Préstamo régimen creado", { id: result.insertId, createdBy });
  return getById(result.insertId);
};

const update = async (id, payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  await getById(id);
  await ensureUniqueContrato(data.noContrato, id);
  await pool.execute(sql("actualizar"), [...toDb(data), id]);
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
