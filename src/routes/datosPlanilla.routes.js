const { Router } = require("express");

const controller = require("../controllers/datosPlanilla.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);
router.get("/", authorizeRoles("ADMIN", "OPERADOR"), controller.list);
router.get("/buscar", authorizeRoles("ADMIN", "OPERADOR"), controller.getByPersona);
router.get("/:id", authorizeRoles("ADMIN", "OPERADOR"), controller.getById);
router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction("DATOS_PLANILLA", "CREAR", "Creacion de datos planilla"), controller.create);
router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("DATOS_PLANILLA", "EDITAR", (req) => `Edicion datos planilla ${req.params.id}`), controller.update);

module.exports = router;
