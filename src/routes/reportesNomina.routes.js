const { Router } = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const controller = require("../controllers/reportesNomina.controller");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

router.use(authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"));
router.get("/planillas", controller.planillas);
router.get("/planilla/:idPlanilla/pdf", auditAction("REPORTES_NOMINA", "EXPORTAR_PDF"), controller.planillaPdf);
router.get("/planilla/:idPlanilla/excel", auditAction("REPORTES_NOMINA", "EXPORTAR_EXCEL"), controller.planillaExcel);
router.get("/planilla/:idPlanilla/ingresos/excel", auditAction("REPORTES_NOMINA", "EXPORTAR_INGRESOS_EXCEL"), controller.ingresosExcel);
router.get("/planilla/:idPlanilla/descuentos/excel", auditAction("REPORTES_NOMINA", "EXPORTAR_DESCUENTOS_EXCEL"), controller.descuentosExcel);
router.get("/planilla/:idPlanilla", controller.planilla);
router.get("/empleado/:idEmpleado", controller.empleado);
router.get("/jubilado/:idJubilado", controller.jubilado);

module.exports = router;
