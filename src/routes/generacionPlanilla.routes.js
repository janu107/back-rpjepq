const { Router } = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const controller = require("../controllers/generacionPlanilla.controller");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

const authorizeGenerate = (req, res, next) => {
  if (req.body?.regenerar && String(req.user?.rol || "").toUpperCase() !== "ADMIN") {
    return res.status(403).json({ ok: false, message: "No tiene permisos para realizar esta accion" });
  }
  return next();
};

router.post("/preview", authorizeRoles("ADMIN", "OPERADOR"), controller.preview);
router.post("/generar", authorizeRoles("ADMIN", "OPERADOR"), authorizeGenerate, auditAction("GENERACION_PLANILLA", "GENERAR", (req) => req.body?.regenerar ? "Regeneracion de planilla" : "Generacion de planilla"), controller.generar);
router.post("/regenerar", authorizeRoles("ADMIN"), auditAction("GENERACION_PLANILLA", "REGENERAR", "Regeneracion de planilla"), controller.generar);
router.get("/validar/:idPlanilla", authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"), controller.validar);
router.get("/resumen/:idPlanilla", authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"), controller.resumen);
router.delete("/limpiar/:idPlanilla", authorizeRoles("ADMIN"), auditAction("GENERACION_PLANILLA", "LIMPIAR", (req) => `Limpieza planilla ${req.params.idPlanilla}`), controller.limpiar);

module.exports = router;
