const path = require("path");
const backupService = require("../services/backup.service");
const { successResponse } = require("../utils/response");

const status = async (req, res, next) => {
  try {
    return successResponse(res, await backupService.status(), "Estado de backups obtenido correctamente");
  } catch (error) {
    next(error);
  }
};

const generar = async (req, res, next) => {
  try {
    return successResponse(res, await backupService.generar(req.user), "Backup generado correctamente", 201);
  } catch (error) {
    next(error);
  }
};

const listar = async (req, res, next) => {
  try {
    return successResponse(res, await backupService.listar(), "Backups listados correctamente");
  } catch (error) {
    next(error);
  }
};

const descargar = async (req, res, next) => {
  try {
    const { name, filePath } = await backupService.registrarDescarga(req.params.nombreArchivo, req.user);
    res.setHeader("Content-Disposition", `attachment; filename=\"${name}\"`);
    res.setHeader("Content-Type", name.endsWith(".gz") ? "application/gzip" : "application/sql");
    return res.sendFile(path.resolve(filePath));
  } catch (error) {
    next(error);
  }
};

const eliminar = async (req, res, next) => {
  try {
    return successResponse(res, await backupService.eliminar(req.params.nombreArchivo, req.user), "Backup eliminado correctamente");
  } catch (error) {
    next(error);
  }
};

const historial = async (req, res, next) => {
  try {
    return successResponse(res, await backupService.historial(), "Historial de backups listado correctamente");
  } catch (error) {
    next(error);
  }
};

const restaurar = async (req, res, next) => {
  try {
    await backupService.restaurar(req.file, req.user);
    return successResponse(res, null, "Base de datos restaurada correctamente");
  } catch (error) {
    next(error);
  }
};

module.exports = { status, generar, listar, descargar, eliminar, historial, restaurar };
