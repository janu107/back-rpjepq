const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

let initialized = false;

const sql = (file) => getSql(`auditoria/${file}.sql`);

const mapAudit = (row) => ({
  id: row.aud_id,
  usuarioId: row.aud_usuario_id,
  usuario: row.aud_usuario,
  rol: row.aud_rol,
  modulo: row.aud_modulo,
  accion: row.aud_accion,
  metodo: row.aud_metodo,
  ruta: row.aud_ruta,
  descripcion: row.aud_descripcion,
  ip: row.aud_ip,
  userAgent: row.aud_user_agent,
  fecha: row.aud_fecha
});

const ensureTable = async () => {
  if (initialized) return;
  await pool.execute(sql("crearTablaAuditoria"));
  initialized = true;
};

const registrar = async ({
  usuarioId = null,
  usuario = null,
  rol = null,
  modulo,
  accion,
  metodo,
  ruta,
  descripcion = null,
  ip = null,
  userAgent = null
}) => {
  try {
    await ensureTable();
    await pool.execute(sql("crear"), [
      usuarioId,
      usuario,
      rol,
      modulo,
      accion,
      metodo,
      ruta,
      descripcion,
      ip,
      userAgent
    ]);
  } catch (error) {
    logger.error("Error al registrar auditoria", { message: error.message, code: error.code, modulo, accion });
  }
};

const listar = async (filters = {}) => {
  await ensureTable();
  const page = Math.max(Number(filters.page || 1), 1);
  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  const offset = (page - 1) * limit;
  const params = [];
  const where = [];

  if (filters.usuario) {
    where.push("aud_usuario LIKE ?");
    params.push(`%${String(filters.usuario).trim()}%`);
  }

  if (filters.modulo) {
    where.push("aud_modulo = ?");
    params.push(String(filters.modulo).trim().toUpperCase());
  }

  if (filters.accion) {
    where.push("aud_accion = ?");
    params.push(String(filters.accion).trim().toUpperCase());
  }

  if (filters.fechaInicio) {
    where.push("DATE(aud_fecha) >= ?");
    params.push(filters.fechaInicio);
  }

  if (filters.fechaFin) {
    where.push("DATE(aud_fecha) <= ?");
    params.push(filters.fechaFin);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const listSql = sql("listar").replace("/*WHERE_CLAUSE*/", whereSql);
  const countSql = sql("contar").replace("/*WHERE_CLAUSE*/", whereSql);
  const [rows] = await pool.query(listSql, [...params, limit, offset]);
  const [countRows] = await pool.query(countSql, params);
  return { rows: rows.map(mapAudit), total: Number(countRows[0]?.total || 0), page, limit };
};

const obtenerPorId = async (id) => {
  await ensureTable();
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) {
    const error = new Error("Registro de auditoria no encontrado");
    error.status = 404;
    throw error;
  }
  return mapAudit(rows[0]);
};

const listarModulos = async () => {
  await ensureTable();
  const [rows] = await pool.execute(sql("filtrarPorModulo"));
  return rows.map((row) => row.aud_modulo);
};

const listarAcciones = async () => {
  await ensureTable();
  const [rows] = await pool.execute(sql("listarAcciones"));
  return rows.map((row) => row.aud_accion);
};

module.exports = { ensureTable, registrar, listar, obtenerPorId, listarModulos, listarAcciones };
