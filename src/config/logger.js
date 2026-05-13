const fs = require("fs");
const path = require("path");

const logsDir = path.resolve(__dirname, "../../logs");
const appLogPath = path.join(logsDir, "app.log");
const errorLogPath = path.join(logsDir, "error.log");

const ensureLogsDir = () => {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
};

const formatMessage = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  const normalizedMessage = typeof message === "string" ? message : JSON.stringify(message);
  const extra = meta ? ` ${JSON.stringify(meta)}` : "";

  return `[${timestamp}] [${level.toUpperCase()}] ${normalizedMessage}${extra}`;
};

const writeLog = (filePath, line) => {
  ensureLogsDir();
  fs.appendFile(filePath, `${line}\n`, (error) => {
    if (error) {
      console.error("[LOGGER] No se pudo escribir el archivo de log:", error.message);
    }
  });
};

const log = (level, message, meta = null) => {
  const line = formatMessage(level, message, meta);

  if (level === "error") {
    console.error(line);
    writeLog(errorLogPath, line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "debug") {
    console.debug(line);
  } else {
    console.log(line);
  }

  writeLog(appLogPath, line);
};

module.exports = {
  info: (message, meta) => log("info", message, meta),
  error: (message, meta) => log("error", message, meta),
  warn: (message, meta) => log("warn", message, meta),
  debug: (message, meta) => log("debug", message, meta)
};
