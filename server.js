require("dotenv").config();

const app = require("./src/app");
const logger = require("./src/config/logger");
const authService = require("./src/services/auth.service");

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

const startServer = async () => {
  try {
    await authService.createInitialAdmin();
  } catch (error) {
    logger.error("No fue posible verificar o crear el usuario administrador inicial", {
      message: error.message,
      code: error.code
    });
  }

  app.listen(PORT, () => {
    const startupMessage = [
      "========================================",
      " API RPJEPQ",
      ` Servidor escuchando en puerto ${PORT}`,
      ` Ambiente: ${NODE_ENV}`,
      ` URL local: http://localhost:${PORT}`,
      ` Health: http://localhost:${PORT}/api/health`,
      ` DB Health: http://localhost:${PORT}/api/health/db`,
      " Usuario inicial: admin",
      "========================================"
    ].join("\n");

    logger.info(startupMessage);
  });
};

startServer();
