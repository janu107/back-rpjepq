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
    const [rows] = await pool.execute(query);

    res.json({
      ok: true,
      message: "Conexión a MySQL exitosa",
      data: rows[0]
    });
  } catch (error) {
    logger.error("Error en endpoint /api/health/db", {
      message: error.message,
      code: error.code
    });

    res.status(500).json({
      ok: false,
      message: "Error al conectar con MySQL",
      error: error.message
    });
  }
};

module.exports = {
  healthCheck,
  databaseHealthCheck
};
