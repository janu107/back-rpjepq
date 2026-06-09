const { Router } = require("express");

const controller = require("../controllers/prestamosRegimen.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);
router.get("/", authorizeRoles("ADMIN", "OPERADOR"), controller.list);
router.get("/:id", authorizeRoles("ADMIN", "OPERADOR"), controller.getById);
router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction("PRESTAMOS_REGIMEN", "CREAR", "Creacion de préstamo régimen"), controller.create);
router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("PRESTAMOS_REGIMEN", "EDITAR", (req) => `Edicion préstamo régimen ${req.params.id}`), controller.update);
router.delete("/:id", authorizeRoles("ADMIN"), auditAction("PRESTAMOS_REGIMEN", "ELIMINAR", (req) => `Eliminacion préstamo régimen ${req.params.id}`), controller.remove);

module.exports = router;
