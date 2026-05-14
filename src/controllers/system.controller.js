const systemService = require("../services/system.service");
const { successResponse } = require("../utils/response");

const status = async (req, res, next) => {
  try {
    return successResponse(res, await systemService.status(), "Estado del sistema obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const storage = async (req, res, next) => {
  try {
    return successResponse(res, await systemService.storage(), "Estado de almacenamiento obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const appLog = async (req, res, next) => {
  try {
    return successResponse(res, systemService.tailLines("app.log"), "Log de aplicacion obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const errorLog = async (req, res, next) => {
  try {
    return successResponse(res, systemService.tailLines("error.log"), "Log de errores obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

module.exports = { status, storage, appLog, errorLog };
