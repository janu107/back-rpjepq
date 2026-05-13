const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const normalizeUser = (user) => ({
  id: user.usu_id,
  usuario: user.usu_usuario,
  nombre: user.usu_nombre,
  correo: user.usu_correo,
  estado: user.usu_estado,
  rol: user.rol_tipo_rol || null
});

const login = async (usuario, contrasena) => {
  logger.info("Intento de login", { usuario });

  if (!usuario || !contrasena) {
    const error = new Error("Usuario y contrasena son obligatorios");
    error.status = 400;
    throw error;
  }

  const query = getSql("auth/findUserByUsername.sql");
  const [rows] = await pool.execute(query, [usuario]);
  const user = rows[0];

  if (!user) {
    logger.warn("Login fallido: usuario no existe", { usuario });
    const error = new Error("Usuario o contrasena incorrectos");
    error.status = 401;
    throw error;
  }

  if (String(user.usu_estado).toUpperCase() !== "ACTIVO") {
    logger.warn("Login fallido: usuario inactivo", { usuario, estado: user.usu_estado });
    const error = new Error("Usuario inactivo");
    error.status = 403;
    throw error;
  }

  const passwordValido = await bcrypt.compare(contrasena, user.usu_contrasena);

  if (!passwordValido) {
    logger.warn("Login fallido: contrasena incorrecta", { usuario });
    const error = new Error("Usuario o contrasena incorrectos");
    error.status = 401;
    throw error;
  }

  const payload = {
    id: user.usu_id,
    usuario: user.usu_usuario,
    rol: user.rol_tipo_rol || null
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h"
  });

  logger.info("Login exitoso", {
    id: user.usu_id,
    usuario: user.usu_usuario,
    rol: user.rol_tipo_rol || null
  });

  return {
    token,
    user: normalizeUser(user)
  };
};

const getUserById = async (id) => {
  logger.info("Consulta de usuario autenticado", { id });

  const query = getSql("auth/findUserById.sql");
  const [rows] = await pool.execute(query, [id]);
  const user = rows[0];

  if (!user) {
    const error = new Error("Usuario autenticado no encontrado");
    error.status = 404;
    throw error;
  }

  return normalizeUser(user);
};

const createInitialAdmin = async () => {
  const adminUser = process.env.ADMIN_USER || "admin";
  const adminName = process.env.ADMIN_NAME || "Administrador RPJEPQ";
  const adminEmail = process.env.ADMIN_EMAIL || "admin@rpjepq.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin123!";
  const adminRole = process.env.ADMIN_ROLE || "ADMIN";

  logger.info("Verificando usuario administrador inicial", { usuario: adminUser });

  const findUserQuery = getSql("auth/findUserByUsername.sql");
  const [existingRows] = await pool.execute(findUserQuery, [adminUser]);

  if (existingRows.length > 0) {
    logger.info("El usuario administrador inicial ya existe", { usuario: adminUser });
    return {
      created: false,
      user: normalizeUser(existingRows[0])
    };
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  const insertUserQuery = getSql("auth/insertAdminUser.sql");
  const [userResult] = await pool.execute(insertUserQuery, [
    adminUser,
    adminName,
    adminEmail,
    hashedPassword,
    adminUser
  ]);

  const userId = userResult.insertId;
  const insertRoleQuery = getSql("auth/insertAdminRole.sql");

  await pool.execute(insertRoleQuery, [adminRole, userId, adminUser]);

  logger.info("Usuario administrador inicial creado", {
    id: userId,
    usuario: adminUser,
    rol: adminRole
  });

  return {
    created: true,
    user: {
      id: userId,
      usuario: adminUser,
      nombre: adminName,
      correo: adminEmail,
      estado: "ACTIVO",
      rol: adminRole
    }
  };
};

module.exports = {
  login,
  getUserById,
  createInitialAdmin
};
