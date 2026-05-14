const fs = require("fs");
const os = require("os");
const path = require("path");

const { pool } = require("../config/db");
const backupService = require("./backup.service");

const rootDir = path.resolve(__dirname, "../..");
const logsDir = path.join(rootDir, "logs");

const formatBytes = backupService.formatBytes;

const dirSize = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((total, name) => {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    return total + (stat.isDirectory() ? dirSize(full) : stat.size);
  }, 0);
};

const checkDb = async () => {
  try {
    await pool.execute("SELECT 1 AS ok");
    return { ok: true, message: "Conexion DB activa" };
  } catch (error) {
    return { ok: false, message: "Conexion DB no disponible" };
  }
};

const status = async () => {
  const memory = process.memoryUsage();
  return {
    api: "OK",
    fechaServidor: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || "development",
    nodeVersion: process.version,
    memoria: {
      rss: formatBytes(memory.rss),
      heapTotal: formatBytes(memory.heapTotal),
      heapUsed: formatBytes(memory.heapUsed)
    },
    uptimeSegundos: Math.round(process.uptime()),
    db: await checkDb()
  };
};

const storage = async () => {
  const free = os.freemem();
  const total = os.totalmem();
  return {
    sistema: {
      memoriaTotal: formatBytes(total),
      memoriaLibre: formatBytes(free),
      memoriaUsada: formatBytes(total - free)
    },
    logs: {
      ruta: "logs/",
      tamano: formatBytes(dirSize(logsDir))
    },
    backups: {
      ruta: "backups/",
      tamano: formatBytes(dirSize(backupService.backupsDir))
    }
  };
};

const tailLines = (fileName, lines = 100) => {
  const filePath = path.join(logsDir, fileName);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return content.split(/\r?\n/).filter(Boolean).slice(-lines);
};

module.exports = { status, storage, tailLines };
