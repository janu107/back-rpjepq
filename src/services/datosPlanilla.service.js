const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { upperCaseFields } = require("../utils/text");

const FORMAS_PAGO = ["ABONO CUENTA", "CHEQUE"];
const TIPOS_CUENTA = ["AHORRO", "MONETARIA"];

const createError = (message, status = 400) => { const error = new Error(message); error.status = status; return error; };

const sql = (file) => getSql(`datos-planilla/${file}.sql`);

const mapRow = (row) => ({
  id: row.dat_correlativo,
  tipoManejo: row.dat_tipo_manejo,
  idEmpleado: row.dat_id_empleado,
  idBanco: row.dat_id_banco,
  formaPago: row.dat_forma_pago,
  cuenta: row.dat_cuenta,
  tipoCuenta: row.dat_tipo_cuenta,
  aplicaDescIgss: Boolean(row.dat_aplica_desc_igss),
  aplicaDescIsr: Boolean(row.dat_aplica_desc_isr),
  aplicaSeguro: Boolean(row.dat_aplica_seguro),
  noProbidad: row.dat_no_probidad,
  noSobrevivencia: row.dat_no_sobrevivencia,
  aplicaNomina: row.dat_aplica_nomina !== undefined ? Boolean(row.dat_aplica_nomina) : true,
  bancoNombre: row.banco_nombre,
  manejoDescripcion: row.manejo_descripcion,
  personaNombre: row.persona_nombre,
  fechaCreacion: row.dat_fecha_creacion,
  usuarioCreacion: row.dat_usuario_creacion
});

const validate = (data) => {
  ["tipoManejo", "idEmpleado", "idBanco", "formaPago"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") throw createError(`El campo ${field} es obligatorio`);
  });
  if (!FORMAS_PAGO.includes(String(data.formaPago).toUpperCase())) throw createError("Forma de pago no permitida. Use: ABONO CUENTA, CHEQUE");
  if (data.tipoCuenta && !TIPOS_CUENTA.includes(String(data.tipoCuenta).toUpperCase())) throw createError("Tipo de cuenta no permitido. Use: AHORRO, MONETARIA");
};

const normalize = (data) => upperCaseFields(data, ["formaPago", "tipoCuenta", "cuenta"]);

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
  if (!rows[0]) throw createError("Datos de planilla no encontrados", 404);
  return mapRow(rows[0]);
};

const getByPersona = async (tipoManejo, idEmpleado) => {
  const [rows] = await pool.execute(sql("buscarPorPersona"), [tipoManejo, idEmpleado]);
  return rows[0] ? mapRow(rows[0]) : null;
};

const create = async (payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  const createdBy = currentUser?.usuario || "sistema";
  const params = [
    data.tipoManejo,
    data.idEmpleado,
    data.idBanco,
    data.formaPago,
    data.cuenta || "",
    data.tipoCuenta || null,
    data.aplicaDescIgss ? 1 : 0,
    data.aplicaDescIsr ? 1 : 0,
    data.aplicaSeguro ? 1 : 0,
    data.noProbidad || null,
    data.noSobrevivencia || null,
    data.aplicaNomina !== undefined ? (data.aplicaNomina ? 1 : 0) : 1,
    createdBy
  ];
  const insertId = await withFkBypass(async (conn) => {
    const [result] = await conn.execute(sql("crear"), params);
    return result.insertId;
  });
  logger.info("Datos planilla creados", { id: insertId, createdBy });
  return getById(insertId);
};

const update = async (id, payload, currentUser) => {
  const data = normalize(payload);
  validate(data);
  await getById(id);
  const params = [
    data.idBanco,
    data.formaPago,
    data.cuenta || "",
    data.tipoCuenta || null,
    data.aplicaDescIgss ? 1 : 0,
    data.aplicaDescIsr ? 1 : 0,
    data.aplicaSeguro ? 1 : 0,
    data.noProbidad || null,
    data.noSobrevivencia || null,
    data.aplicaNomina !== undefined ? (data.aplicaNomina ? 1 : 0) : 1,
    id
  ];
  await withFkBypass(async (conn) => {
    await conn.execute(sql("actualizar"), params);
  });
  logger.info("Datos planilla actualizados", { id, updatedBy: currentUser?.usuario });
  return getById(id);
};

module.exports = { list, getById, getByPersona, create, update };
