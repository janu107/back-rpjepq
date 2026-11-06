const { Router } = require("express");

const controllers = require("../controllers/prestamosRegimen.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

// Misma estructura para los dos: /prestamos-regimen (empleados, Proceso Régimen)
// y /prestamos-jubilados (jubilados, Jubilados y Pensiones).
const crearRouter = (controller, modulo, nombre) => {
  const router = Router();
  router.use(authMiddleware);
  router.get("/", authorizeRoles("ADMIN", "OPERADOR"), controller.list);
  router.get("/:id", authorizeRoles("ADMIN", "OPERADOR"), controller.getById);
  router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction(modulo, "CREAR", `Creacion de ${nombre}`), controller.create);
  router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction(modulo, "EDITAR", (req) => `Edicion ${nombre} ${req.params.id}`), controller.update);
  router.delete("/:id", authorizeRoles("ADMIN"), auditAction(modulo, "ELIMINAR", (req) => `Eliminacion ${nombre} ${req.params.id}`), controller.remove);
  return router;
};

module.exports = crearRouter(controllers.empleados, "PRESTAMOS_REGIMEN", "préstamo régimen");
module.exports.jubilados = crearRouter(controllers.jubilados, "PRESTAMOS_JUBILADOS", "préstamo jubilado");
