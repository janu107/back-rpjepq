require("dotenv").config();

const backupService = require("../src/services/backup.service");
const logger = require("../src/config/logger");

const run = async () => {
  try {
    const data = await backupService.generar({ usuario: "cron" }, "AUTOMATICO", "Backup automatico por script");
    logger.info("Backup automatico generado", data);
    console.log(`Backup generado: ${data.archivoComprimido}`);
    process.exit(0);
  } catch (error) {
    logger.error("Error en backup automatico", { message: error.message, code: error.code });
    console.error("No se pudo generar backup");
    process.exit(1);
  }
};

run();
