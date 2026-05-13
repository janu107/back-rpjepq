const mysql = require("mysql2/promise");
const logger = require("./logger");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const testConnection = async () => {
  let connection;

  try {
    connection = await pool.getConnection();
    logger.info("Conexión a MySQL exitosa", {
      database: process.env.DB_NAME,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306
    });

    return true;
  } catch (error) {
    logger.error("Error al conectar con MySQL", {
      message: error.message,
      code: error.code
    });
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

module.exports = {
  pool,
  testConnection
};
