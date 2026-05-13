require("dotenv").config();

const { pool } = require("../src/config/db");
const logger = require("../src/config/logger");
const authService = require("../src/services/auth.service");

const run = async () => {
  try {
    const result = await authService.createInitialAdmin();

    if (result.created) {
      logger.info("Seed admin finalizado: administrador creado", {
        usuario: result.user.usuario,
        rol: result.user.rol
      });
    } else {
      logger.info("Seed admin finalizado: administrador existente", {
        usuario: result.user.usuario,
        rol: result.user.rol
      });
    }
  } catch (error) {
    logger.error("Error al crear administrador inicial", {
      message: error.message,
      code: error.code
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

run();
