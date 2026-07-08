const { Router } = require("express");

const controller = require("../controllers/nominasJubilados.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");

router.post("/jubilados/generar", ADMIN_OP, auditAction("NOMINA_JUBILADOS", "GENERAR", (req) => `Generar nomina jubilados planilla ${req.body?.idPlanilla}`), controller.generarJubilados);
router.post("/amparistas/generar", ADMIN_OP, auditAction("NOMINA_AMPARISTAS", "GENERAR", (req) => `Generar nomina amparistas planilla ${req.body?.idPlanilla}`), controller.generarAmparistas);
router.post("/:idPlanilla/revertir", ADMIN_OP, auditAction("NOMINA_JUBILADOS", "REVERTIR", (req) => `Revertir nomina planilla ${req.params.idPlanilla}`), controller.revertir);

module.exports = router;
