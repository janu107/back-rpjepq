const { Router } = require("express");
const controller = require("../controllers/sesiones.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");

router.get("/", ADMIN_OP, controller.list);
router.get("/:id/asistencia", ADMIN_OP, controller.getAsistencia);
router.get("/:id", ADMIN_OP, controller.getById);
router.post("/", ADMIN_OP, auditAction("SESIONES", "CREAR", "Registrar sesión de junta"), controller.create);
router.put("/:id", ADMIN_OP, auditAction("SESIONES", "EDITAR", (req) => `Editar sesión ${req.params.id}`), controller.update);
router.post("/:id/anular", ADMIN_OP, auditAction("SESIONES", "ANULAR", (req) => `Anular sesión ${req.params.id}`), controller.anular);

module.exports = router;
