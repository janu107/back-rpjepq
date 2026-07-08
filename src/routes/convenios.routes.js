const { Router } = require("express");

const controller = require("../controllers/convenios.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");

router.get("/candidatos", ADMIN_OP, controller.candidatos);
router.get("/vigentes", ADMIN_OP, controller.vigentes);
router.get("/deuda/:tipo/:id", ADMIN_OP, controller.deuda);
router.post("/crear", ADMIN_OP, auditAction("CONVENIOS", "CREAR", (req) => `Crear convenio doc ${req.body?.noDocumento}`), controller.crear);
router.put("/:id/cancelar", ADMIN_OP, auditAction("CONVENIOS", "CANCELAR", (req) => `Cancelar convenio ${req.params.id}`), controller.cancelar);

module.exports = router;
