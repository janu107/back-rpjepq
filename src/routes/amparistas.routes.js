const { Router } = require("express");

const controller = require("../controllers/amparistas.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

// Registrar y consultar: ADMIN u OPERADOR. Revocar: SOLO ADMIN.
router.post("/registrar", authorizeRoles("ADMIN", "OPERADOR"), auditAction("AMPARISTAS", "REGISTRAR", (req) => `Registrar amparista expediente ${req.body?.noExpediente}`), controller.registrar);
router.get("/vigentes", authorizeRoles("ADMIN", "OPERADOR"), controller.vigentes);
router.get("/verificar-expediente", authorizeRoles("ADMIN", "OPERADOR"), controller.verificarExpediente);
router.post("/:id/revocar", authorizeRoles("ADMIN"), auditAction("AMPARISTAS", "REVOCAR", (req) => `Revocar amparista (juicio ${req.params.id})`), controller.revocar);

module.exports = router;
