const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

// Catálogo de roles. Un usuario puede tener VARIOS (una fila por rol en RPJ_ADM_ROL).
//   - ADMIN y OPERADOR son los roles originales: se conservan para que las cuentas
//     existentes no pierdan acceso. ADMIN sigue siendo el único que gestiona
//     usuarios, roles y auditoría.
//   - Los demás son el listado nuevo, con alcance por módulo (ver role.middleware).
const ROLES = [
  { rol: "CATALOGOS", descripcion: "Todos los catálogos: ver, crear y modificar (Manejo administración solo lectura)" },
  { rol: "EPQ", descripcion: "Módulo de Mantenimiento EPQ: ver, crear y actualizar" },
  { rol: "REGIMEN", descripcion: "Módulo de Régimen: ver, crear y actualizar" },
  { rol: "JUBILADOS", descripcion: "Módulo de Jubilados: ver, crear y actualizar" },
  { rol: "REPORTES", descripcion: "Solo reportes e impresiones" },
  { rol: "ADMINISTRACION", descripcion: "Todos los módulos: ver, crear y modificar" },
  { rol: "CONSULTA", descripcion: "Solo lectura de los módulos EPQ, Régimen y Jubilados" },
  { rol: "ADMIN", descripcion: "Superusuario: todo el sistema, usuarios, roles y auditoría", heredado: true },
  { rol: "OPERADOR", descripcion: "Rol anterior: crear y modificar en todos los módulos", heredado: true }
];

const TIPOS_ROL = ROLES.map((r) => r.rol);

const validateRole = (rol) => {
  if (!TIPOS_ROL.includes(String(rol || "").toUpperCase())) {
    const error = new Error("Rol no permitido");
    error.status = 400;
    throw error;
  }

  return String(rol).toUpperCase();
};

// Acepta ["A","B"], "A,B" o un solo rol; valida, quita repetidos y exige al menos uno.
const normalizeRoles = (input) => {
  const lista = Array.isArray(input) ? input : String(input ?? "").split(",");
  const roles = [...new Set(lista.map((r) => String(r).trim()).filter(Boolean).map(validateRole))];
  if (!roles.length) {
    const error = new Error("Debe asignar al menos un rol");
    error.status = 400;
    throw error;
  }
  return roles;
};

const splitRoles = (valor) => String(valor || "").split(",").map((r) => r.trim()).filter(Boolean);

const mapRole = (row) => {
  const roles = splitRoles(row.roles);
  return {
    usuarioId: row.usu_id,
    rol: roles.join(", "),
    roles,
    fechaCreacion: row.rol_fecha_creacion,
    usuario: row.usu_usuario,
    nombre: row.usu_nombre,
    correo: row.usu_correo,
    estado: row.usu_estado
  };
};

const listRoles = async () => {
  logger.info("Listado de roles solicitado");
  const [rows] = await pool.execute(getSql("roles/listarRoles.sql"));
  return rows.map(mapRole);
};

const listRoleTypes = () => ROLES;

// Reemplaza el conjunto de roles del usuario por exactamente `roles`.
// Sólo agrega/quita la diferencia, para conservar la fecha de los roles que siguen.
const setUserRoles = async (userId, roles, createdBy = "sistema", connection = pool) => {
  const normalized = normalizeRoles(roles);
  const [actuales] = await connection.execute(getSql("roles/listarRolesPorUsuario.sql"), [userId]);
  const actualesNombres = actuales.map((r) => r.rol_tipo_rol);

  for (const rol of actualesNombres.filter((r) => !normalized.includes(r))) {
    await connection.execute(getSql("roles/eliminarRolUsuario.sql"), [userId, rol]);
  }
  for (const rol of normalized.filter((r) => !actualesNombres.includes(r))) {
    await connection.execute(getSql("roles/crearRolUsuario.sql"), [rol, userId, createdBy]);
  }

  logger.info("Roles de usuario actualizados", { userId, roles: normalized });
  return { action: "updated", roles: normalized, rol: normalized.join(", ") };
};

// Usado por la pantalla de usuarios, que maneja UN rol: se asegura de que el usuario
// lo tenga. Si ya lo tiene (aunque tenga otros más) no se toca nada, para no borrar
// los roles extra asignados desde la pantalla de Roles. Si tiene uno solo distinto, se cambia.
const upsertUserRole = async (userId, rol, createdBy = "sistema", connection = pool) => {
  const normalizedRole = validateRole(rol);
  const [existentes] = await connection.execute(getSql("roles/listarRolesPorUsuario.sql"), [userId]);
  const nombres = existentes.map((r) => r.rol_tipo_rol);

  if (nombres.includes(normalizedRole)) return { action: "unchanged", rol: normalizedRole };

  if (nombres.length === 1) {
    await connection.execute(getSql("roles/actualizarRolUsuario.sql"), [normalizedRole, userId]);
    logger.info("Rol de usuario actualizado", { userId, rol: normalizedRole });
    return { action: "updated", rol: normalizedRole };
  }

  if (nombres.length > 1) return setUserRoles(userId, [normalizedRole], createdBy, connection);

  await connection.execute(getSql("roles/crearRolUsuario.sql"), [normalizedRole, userId, createdBy]);
  logger.info("Rol de usuario creado", { userId, rol: normalizedRole });
  return { action: "created", rol: normalizedRole };
};

module.exports = {
  ROLES,
  TIPOS_ROL,
  validateRole,
  normalizeRoles,
  splitRoles,
  listRoles,
  listRoleTypes,
  setUserRoles,
  upsertUserRole
};
