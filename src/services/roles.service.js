const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const TIPOS_ROL = ["ADMIN", "OPERADOR", "CONSULTA"];

const validateRole = (rol) => {
  if (!TIPOS_ROL.includes(String(rol || "").toUpperCase())) {
    const error = new Error("Rol no permitido");
    error.status = 400;
    throw error;
  }

  return String(rol).toUpperCase();
};

const mapRole = (row) => ({
  id: row.rol_id,
  rol: row.rol_tipo_rol,
  usuarioId: row.rol_usuario,
  fechaCreacion: row.rol_fecha_creacion,
  usuarioCreacion: row.rol_usuario_creacion,
  usuario: row.usu_usuario,
  nombre: row.usu_nombre,
  correo: row.usu_correo,
  estado: row.usu_estado
});

const listRoles = async () => {
  logger.info("Listado de roles solicitado");
  const [rows] = await pool.execute(getSql("roles/listarRoles.sql"));
  return rows.map(mapRole);
};

const upsertUserRole = async (userId, rol, createdBy = "sistema", connection = pool) => {
  const normalizedRole = validateRole(rol);
  const [existingRows] = await connection.execute(getSql("roles/obtenerRolPorUsuario.sql"), [userId]);

  if (existingRows.length > 0) {
    await connection.execute(getSql("roles/actualizarRolUsuario.sql"), [normalizedRole, userId]);
    logger.info("Rol de usuario actualizado", { userId, rol: normalizedRole });
    return { action: "updated", rol: normalizedRole };
  }

  await connection.execute(getSql("roles/crearRolUsuario.sql"), [normalizedRole, userId, createdBy]);
  logger.info("Rol de usuario creado", { userId, rol: normalizedRole });
  return { action: "created", rol: normalizedRole };
};

module.exports = {
  TIPOS_ROL,
  validateRole,
  listRoles,
  upsertUserRole
};
