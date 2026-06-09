const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { upperCaseFields } = require("../utils/text");

const TIPOS_PERSONA = ["EMPLEADO", "JUBILADO"];
const FORMAS_PAGO = ["ABONO CUENTA", "CHEQUE"];
const TIPOS_CUENTA = ["AHORRO", "MONETARIA"];
const ESTADOS = ["ACTIVO", "INACTIVO"];

const createError = (message, status = 400) => { const error = new Error(message); error.status = status; return error; };

const sql = (file) => getSql(`datos-planilla/${file}.sql`);

const mapRow = (row) => ({
  id: row.dpl_id,
  tipoManejo: row.dpl_tipo_manejo,
  tipoPersona: row.dpl_tipo_persona,
  idPersona: row.dpl_id_persona,
  idBanco: row.dpl_id_banco,
  noCuenta: row.dpl_no_cuenta,
  formaPago: row.dpl_forma_pago,
  tipoCuenta: row.dpl_tipo_cuenta,
  estado: row.dpl_estado,
  bancoNombre: row.banco_nombre,
  fechaCreacion: row.dpl_fecha_creacion,
  usuarioCreacion: row.dpl_usuario_creacion
});

const validate = (data) => {
  ["tipoManejo", "tipoPersona", "idPersona", "idBanco", "formaPago"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") throw createError(`El campo ${field} es obligatorio`);
  });
  if (!TIPOS_PERSONA.includes(String(data.tipoPersona).toUpperCase())) throw createError("Tipo persona no permitido. Use: EMPLEADO, JUBILADO");
  if (!FORMAS_PAGO.includes(String(data.formaPago).toUpperCase())) throw createError("Forma de pago no permitida. Use: ABONO CUENTA, CHEQUE");
  if (data.tipoCuenta && !TIPOS_CUENTA.includes(String(data.tipoCuenta).toUpperCase())) throw createError("Tipo de cuenta no permitido. Use: AHORRO, MONETARIA");
  if (data.estado && !ESTADOS.includes(String(data.estado).toUpperCase())) throw createError("Estado no permitido. Use: ACTIVO, INACTIVO");
};

const normalize = (data) => upperCaseFields(data, ["tipoPersona", "noCuenta", "formaPago", "tipoCuenta", "estado"]);

const list = async () => {
  const [rows] = await pool.execute(sql("listar"));
  return rows.map(mapRow);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Datos de planilla no encontrados", 404);
  return mapRow(rows[0]);
};

const getByPersona = async (tipoPersona, idPersona) => {
  const [rows] = await pool.execute(sql("buscarPorPersona"), [String(tipoPersona).toUpperCase(), idPersona]);
  return rows[0] ? mapRow(rows[0]) : null;
};

const create = async (payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  const createdBy = currentUser?.usuario || "sistema";
  const params = [
    data.tipoManejo,
    data.tipoPersona,
    data.idPersona,
    data.idBanco,
    data.noCuenta || "",
    data.formaPago,
    data.tipoCuenta || null,
    data.estado || "ACTIVO",
    createdBy
  ];
  const [result] = await pool.execute(sql("crear"), params);
  logger.info("Datos planilla creados", { id: result.insertId, createdBy });
  return getById(result.insertId);
};

const update = async (id, payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  await getById(id);
  const params = [
    data.tipoManejo,
    data.idBanco,
    data.noCuenta || "",
    data.formaPago,
    data.tipoCuenta || null,
    data.estado || "ACTIVO",
    id
  ];
  await pool.execute(sql("actualizar"), params);
  logger.info("Datos planilla actualizados", { id, updatedBy: currentUser?.usuario });
  return getById(id);
};

module.exports = { list, getById, getByPersona, create, update };
