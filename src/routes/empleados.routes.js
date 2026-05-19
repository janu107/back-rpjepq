const { Router } = require("express");

const controller = require("../controllers/empleados.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);
router.get("/", authorizeRoles("ADMIN", "OPERADOR"), controller.list);
router.get("/:id", authorizeRoles("ADMIN", "OPERADOR"), controller.getById);
router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction("EMPLEADOS", "CREAR", "Creacion de empleado"), controller.create);
router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("EMPLEADOS", "EDITAR", (req) => `Edicion empleado ${req.params.id}`), controller.update);
router.delete("/:id", authorizeRoles("ADMIN"), auditAction("EMPLEADOS", "ELIMINAR", (req) => `Eliminacion empleado ${req.params.id}`), controller.remove);

module.exports = router;
