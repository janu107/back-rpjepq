const service = require("../services/prestamosRegimen.service");
const { successResponse } = require("../utils/response");

// tipo = 1 (empleados, /prestamos-regimen) o 2 (jubilados, /prestamos-jubilados).
const crear = (tipo, nombre) => ({
  list: async (req, res, next) => { try { return successResponse(res, await service.list(tipo), `${nombre} listados correctamente`); } catch (error) { next(error); } },
  getById: async (req, res, next) => { try { return successResponse(res, await service.getById(req.params.id, tipo), "Préstamo obtenido correctamente"); } catch (error) { next(error); } },
  create: async (req, res, next) => { try { return successResponse(res, await service.create(req.body, req.user, tipo), "Préstamo creado correctamente", 201); } catch (error) { next(error); } },
  update: async (req, res, next) => { try { return successResponse(res, await service.update(req.params.id, req.body, req.user, tipo), "Préstamo actualizado correctamente"); } catch (error) { next(error); } },
  remove: async (req, res, next) => { try { return successResponse(res, await service.remove(req.params.id, req.user, tipo), "Préstamo eliminado correctamente"); } catch (error) { next(error); } }
});

module.exports = { empleados: crear(1, "Préstamos régimen"), jubilados: crear(2, "Préstamos jubilados") };
