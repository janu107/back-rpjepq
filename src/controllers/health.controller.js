const { pool, testConnection } = require("../config/db");
const logger = require("../config/logger");
const getSql = require("../utils/sqlLoader");

const healthCheck = (req, res) => {
  res.json({
    ok: true,
    message: "API RPJEPQ funcionando correctamente",
    timestamp: new Date().toISOString()
  });
};

const databaseHealthCheck = async (req, res) => {
  try {
    await testConnection();

    const query = getSql("health/testConnection.sql");
    await pool.execute(query);

    // Endpoint público: no se devuelve nombre ni versión de la base.
    res.json({
      ok: true,
      message: "Conexión a MySQL exitosa"
    });
  } catch (error) {
    logger.error("Error en endpoint /api/health/db", {
      message: error.message,
      code: error.code
    });

    res.status(500).json({
      ok: false,
      message: "Error al conectar con la base de datos"
    });
  }
};

module.exports = {
  healthCheck,
  databaseHealthCheck
};
