const { Router } = require("express");
const controller = require("../controllers/nominaTiempoExtra.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");

router.get("/", ADMIN_OP, controller.list);
router.post("/", ADMIN_OP, auditAction("NOMINA_TIEMPO_EXTRA", "CREAR", "Crear planilla tiempo extra"), controller.create);
router.get("/:id/detalle", ADMIN_OP, controller.getDetalle);
router.get("/:id", ADMIN_OP, controller.getById);
router.post("/:id/generar", ADMIN_OP, auditAction("NOMINA_TIEMPO_EXTRA", "GENERAR", (req) => `Generar nomina tiempo extra ${req.params.id}`), controller.generar);

module.exports = router;
