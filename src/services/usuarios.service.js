const bcrypt = require("bcryptjs");

const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const rolesService = require("./roles.service");

const ESTADOS = ["ACTIVO", "INACTIVO"];
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const mapUser = (row) => ({
  id: row.usu_id,
  usuario: row.usu_usuario,
  nombre: row.usu_nombre,
  correo: row.usu_correo,
  estado: row.usu_estado,
  fechaInicio: row.usu_fecha_inicio,
  fechaCreacion: row.usu_fecha_creacion,
  rolId: row.rol_id,
  rol: row.rol_tipo_rol || null
});

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const validateEstado = (estado) => {
  const normalized = String(estado || "").toUpperCase();
  if (!ESTADOS.includes(normalized)) {
    throw createError("Estado no permitido");
  }
  return normalized;
};

const validatePassword = (contrasena) => {
  if (!contrasena || String(contrasena).length < 8) {
    throw createError("La contrasena debe tener al menos 8 caracteres");
  }
};

const validateUserPayload = (payload, isCreate = true) => {
  const usuario = String(payload.usuario || "").trim();
  const nombre = String(payload.nombre || "").trim();
  const correo = String(payload.correo || "").trim();
  const fechaInicio = payload.fechaInicio;
  const estado = validateEstado(payload.estado || "ACTIVO");
  const rol = rolesService.validateRole(payload.rol);

  if (isCreate && (!usuario || usuario.length < 3 || /\s/.test(usuario))) {
    throw createError("El usuario es obligatorio, minimo 3 caracteres y sin espacios");
  }

  if (!nombre) {
    throw createError("El nombre es obligatorio");
  }

  if (!correo || !emailRegex.test(correo)) {
    throw createError("Correo invalido");
  }

  if (!fechaInicio) {
    throw createError("La fecha de inicio es obligatoria");
  }

  if (isCreate) {
    validatePassword(payload.contrasena);
  }

  return {
    usuario,
    nombre,
    correo,
    estado,
    fechaInicio,
    contrasena: payload.contrasena,
    rol
  };
};

const ensureUniqueUser = async (usuario, correo, excludeId = null, connection = pool) => {
  if (usuario) {
    const [userRows] = await connection.execute(getSql("usuarios/buscarUsuarioPorUsername.sql"), [usuario]);
    if (userRows.some((row) => Number(row.usu_id) !== Number(excludeId))) {
      throw createError("El usuario ya existe", 409);
    }
  }

  const [emailRows] = await connection.execute(getSql("usuarios/buscarUsuarioPorCorreo.sql"), [correo]);
  if (emailRows.some((row) => Number(row.usu_id) !== Number(excludeId))) {
    throw createError("El correo ya existe", 409);
  }
};

const listUsers = async () => {
  logger.info("Listado de usuarios solicitado");
  const [rows] = await pool.execute(getSql("usuarios/listarUsuarios.sql"));
  return rows.map(mapUser);
};

const getUserById = async (id) => {
  const [rows] = await pool.execute(getSql("usuarios/obtenerUsuarioPorId.sql"), [id]);
  if (!rows[0]) {
    throw createError("Usuario no encontrado", 404);
  }
  return mapUser(rows[0]);
};

const createUser = async (payload, currentUser) => {
  const data = validateUserPayload(payload, true);
  const createdBy = currentUser?.usuario || "sistema";
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureUniqueUser(data.usuario, data.correo, null, connection);

    const hashedPassword = await bcrypt.hash(data.contrasena, 10);
    const [result] = await connection.execute(getSql("usuarios/crearUsuario.sql"), [
      data.usuario,
      data.nombre,
      data.correo,
      data.estado,
      data.fechaInicio,
      hashedPassword,
      createdBy
    ]);

    await rolesService.upsertUserRole(result.insertId, data.rol, createdBy, connection);
    await connection.commit();

    logger.info("Usuario creado", { id: result.insertId, usuario: data.usuario, rol: data.rol, createdBy });
    return getUserById(result.insertId);
  } catch (error) {
    await connection.rollback();
    logger.error("Error al crear usuario", { message: error.message, usuario: data.usuario });
    throw error;
  } finally {
    connection.release();
  }
};

const updateUser = async (id, payload, currentUser) => {
  const data = validateUserPayload(payload, false);
  const updatedBy = currentUser?.usuario || "sistema";
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await getUserById(id);
    await ensureUniqueUser(null, data.correo, id, connection);

    await connection.execute(getSql("usuarios/actualizarUsuario.sql"), [
      data.nombre,
      data.correo,
      data.estado,
      data.fechaInicio,
      id
    ]);
    await rolesService.upsertUserRole(id, data.rol, updatedBy, connection);
    await connection.commit();

    logger.info("Usuario actualizado", { id, rol: data.rol, updatedBy });
    return getUserById(id);
  } catch (error) {
    await connection.rollback();
    logger.error("Error al actualizar usuario", { id, message: error.message });
    throw error;
  } finally {
    connection.release();
  }
};

const changeStatus = async (id, estado, currentUser) => {
  const normalizedStatus = validateEstado(estado);
  await getUserById(id);
  await pool.execute(getSql("usuarios/cambiarEstadoUsuario.sql"), [normalizedStatus, id]);
  logger.info("Estado de usuario actualizado", { id, estado: normalizedStatus, updatedBy: currentUser?.usuario });
  return getUserById(id);
};

const changePassword = async (id, contrasena, currentUser) => {
  validatePassword(contrasena);
  await getUserById(id);
  const hashedPassword = await bcrypt.hash(contrasena, 10);
  await pool.execute(getSql("usuarios/cambiarPasswordUsuario.sql"), [hashedPassword, id]);
  logger.info("Contrasena de usuario actualizada", { id, updatedBy: currentUser?.usuario });
  return { id };
};

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  changeStatus,
  changePassword
};
