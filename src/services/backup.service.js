const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { spawn } = require("child_process");

const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const rootDir = path.resolve(__dirname, "../..");
const backupsDir = path.join(rootDir, "backups");
const restoreDir = path.join(rootDir, "temp", "restore");
let initialized = false;

const sql = (file) => getSql(`backup/${file}.sql`);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const ensureDirs = () => {
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.mkdirSync(restoreDir, { recursive: true });
};

const ensureTable = async () => {
  if (initialized) return;
  ensureDirs();
  await pool.execute(sql("crearTablaBackup"));
  initialized = true;
};

const timestamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const safeName = (nombreArchivo) => {
  const base = path.basename(nombreArchivo || "");
  if (!base || base !== nombreArchivo || !/^[\w.-]+\.sql(\.gz)?$/.test(base)) {
    throw createError("Nombre de archivo invalido", 400);
  }
  return base;
};

const registerHistory = async ({ archivo, tipo, tamano, user, accion, observacion }) => {
  await ensureTable();
  await pool.execute(sql("registrarBackup"), [
    archivo,
    tipo,
    tamano,
    user?.id || null,
    user?.usuario || null,
    accion,
    observacion || null
  ]);
};

const runCommand = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, windowsHide: true });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) return resolve();
    return reject(createError(`Proceso finalizo con codigo ${code}: ${stderr.slice(0, 300)}`, 500));
  });
});

// Ejecuta mysql/mysqldump con las credenciales del .env en un archivo de opciones
// temporal (permisos 600, se borra al terminar):
// - la contraseña no va como argumento "-p...", que cualquiera ve con `ps`;
// - --defaults-file hace que se ignore ~/.my.cnf (en el servidor, el de root fuerza
//   user=root y pisaba las credenciales; MYSQL_PWD tampoco sirve por eso).
const optionValue = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const runDbCommand = async (command, args, options = {}) => {
  const lines = [
    "[client]",
    `host=${optionValue(process.env.DB_HOST || "localhost")}`,
    `port=${Number(process.env.DB_PORT || 3306)}`,
    `user=${optionValue(process.env.DB_USER || "root")}`
  ];
  if (process.env.DB_PASSWORD) lines.push(`password=${optionValue(process.env.DB_PASSWORD)}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpj-db-"));
  const optionsFile = path.join(dir, "client.cnf");
  fs.writeFileSync(optionsFile, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    // --defaults-file debe ser el primer argumento.
    await runCommand(command, [`--defaults-file=${optionsFile}`, ...args], options);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const gzipFile = (source, target) => new Promise((resolve, reject) => {
  const input = fs.createReadStream(source);
  const output = fs.createWriteStream(target);
  input.on("error", reject);
  output.on("error", reject);
  output.on("finish", resolve);
  input.pipe(zlib.createGzip()).pipe(output);
});

const generar = async (user, tipo = "MANUAL", observacion = null) => {
  await ensureTable();
  const dbName = process.env.DB_NAME || "apps_rpjepq";
  const file = `${dbName}_${timestamp()}.sql`;
  const gzFile = `${file}.gz`;
  const filePath = path.join(backupsDir, file);
  const gzPath = path.join(backupsDir, gzFile);

  logger.info("Generando backup de base de datos", { dbName, user: user?.usuario, tipo });
  const outFd = fs.openSync(filePath, "w");
  try {
    await runDbCommand("mysqldump", ["--single-transaction", "--routines", "--triggers", dbName], { stdio: ["ignore", outFd, "pipe"] });
    await gzipFile(filePath, gzPath);
  } catch (error) {
    if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath);
    throw error;
  } finally {
    fs.closeSync(outFd);
    // Solo se conserva el .gz; el .sql sin comprimir duplicaba el espacio en disco.
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  const size = fs.statSync(gzPath).size;
  const tamano = formatBytes(size);
  await registerHistory({ archivo: gzFile, tipo, tamano, user, accion: "GENERADO", observacion });

  return {
    archivo: file,
    archivoComprimido: gzFile,
    fecha: new Date().toISOString(),
    tamano
  };
};

const listar = async () => {
  ensureDirs();
  const files = fs.readdirSync(backupsDir)
    .filter((name) => name.endsWith(".sql") || name.endsWith(".sql.gz"))
    .map((name) => {
      const stat = fs.statSync(path.join(backupsDir, name));
      return { nombre: name, tamano: formatBytes(stat.size), fechaCreacion: stat.birthtime, rutaInterna: `backups/${name}` };
    })
    .sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
  return files;
};

const status = async () => {
  const backups = await listar();
  const last = backups[0] || null;
  return {
    carpetaExiste: fs.existsSync(backupsDir),
    cantidadBackups: backups.length,
    ultimoBackup: last?.nombre || null,
    tamanoUltimoBackup: last?.tamano || null
  };
};

const getDownloadPath = (nombreArchivo) => {
  const name = safeName(nombreArchivo);
  const filePath = path.join(backupsDir, name);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(backupsDir))) throw createError("Archivo invalido", 400);
  if (!fs.existsSync(resolved)) throw createError("Backup no encontrado", 404);
  return { name, filePath: resolved };
};

const eliminar = async (nombreArchivo, user) => {
  const { name, filePath } = getDownloadPath(nombreArchivo);
  const stat = fs.statSync(filePath);
  fs.unlinkSync(filePath);
  await registerHistory({ archivo: name, tipo: "MANUAL", tamano: formatBytes(stat.size), user, accion: "ELIMINADO" });
  logger.info("Backup eliminado", { archivo: name, user: user?.usuario });
  return { nombre: name };
};

const registrarDescarga = async (nombreArchivo, user) => {
  const { name, filePath } = getDownloadPath(nombreArchivo);
  const stat = fs.statSync(filePath);
  await registerHistory({ archivo: name, tipo: "MANUAL", tamano: formatBytes(stat.size), user, accion: "DESCARGADO" });
  return { name, filePath };
};

const historial = async () => {
  await ensureTable();
  const [rows] = await pool.execute(sql("listarHistorial"));
  return rows.map((row) => ({
    id: row.bak_id,
    nombreArchivo: row.bak_nombre_archivo,
    tipo: row.bak_tipo,
    tamano: row.bak_tamano,
    usuarioId: row.bak_usuario_id,
    usuario: row.bak_usuario,
    accion: row.bak_accion,
    fecha: row.bak_fecha,
    observacion: row.bak_observacion
  }));
};

const gunzipToTemp = (source) => new Promise((resolve, reject) => {
  const target = source.replace(/\.gz$/, "");
  const input = fs.createReadStream(source);
  const output = fs.createWriteStream(target);
  input.on("error", reject);
  output.on("error", reject);
  output.on("finish", () => resolve(target));
  input.pipe(zlib.createGunzip()).pipe(output);
});

const restaurar = async (file, user) => {
  if (!file) throw createError("Debe adjuntar un archivo SQL o SQL.GZ");
  const originalName = path.basename(file.originalname || file.filename || "");
  if (!originalName.endsWith(".sql") && !originalName.endsWith(".sql.gz")) {
    throw createError("Solo se permiten archivos .sql o .sql.gz");
  }

  logger.warn("Restauracion solicitada", { archivo: originalName, user: user?.usuario });
  await generar(user, "AUTOMATICO", "Backup automatico previo a restauracion");

  let restorePath = file.path;
  if (restorePath.endsWith(".gz")) {
    restorePath = await gunzipToTemp(restorePath);
  }

  let inFd;
  try {
    inFd = fs.openSync(restorePath, "r");
    await runDbCommand("mysql", [process.env.DB_NAME || "apps_rpjepq"], {
      stdio: [inFd, "ignore", "pipe"]
    });
    await registerHistory({ archivo: originalName, tipo: "RESTAURACION", tamano: formatBytes(file.size), user, accion: "RESTAURADO" });
    logger.info("Base de datos restaurada correctamente", { archivo: originalName, user: user?.usuario });
    return { archivo: originalName };
  } catch (error) {
    logger.error("No se pudo restaurar la base de datos", { archivo: originalName, message: error.message });
    throw createError("No se pudo restaurar la base de datos", 500);
  } finally {
    if (inFd !== undefined) fs.closeSync(inFd);
    [file.path, restorePath].forEach((target) => {
      if (target && fs.existsSync(target)) fs.unlinkSync(target);
    });
  }
};

module.exports = { backupsDir, restoreDir, formatBytes, generar, listar, status, getDownloadPath, registrarDescarga, eliminar, historial, restaurar };
