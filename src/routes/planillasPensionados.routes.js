const { Router } = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const controller = require("../controllers/planillasPensionados.controller");

const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");
const ADMIN_ONLY = authorizeRoles("ADMIN");

// Rutas estáticas primero (antes que los params dinámicos)
router.get("/jubilados/:id/estado-cuenta", ADMIN_OP, controller.estadoCuenta);
router.post("/deuda-historica/masivo", ADMIN_ONLY, auditAction("PLANILLA_PENSIONADOS", "DEUDA_HISTORICA", "Carga masiva de deuda historica"), controller.generarDeudaHistoricaMasivo);

// Planillas CRUD
router.get("/",   ADMIN_OP, controller.list);
router.post("/",  ADMIN_OP, auditAction("PLANILLA_PENSIONADOS", "CREAR", "Crear planilla pensionados"), controller.create);

// Rutas por :id con sub-rutas específicas (antes del GET /:id base)
router.get("/:id/preview",  ADMIN_OP, controller.preview);
router.get("/:id/detalle",  ADMIN_OP, controller.getDetalle);
router.get("/:id/export/excel", ADMIN_OP, controller.exportExcel);
router.get("/:id/export/banco", ADMIN_OP, controller.exportBanco);

router.post("/:id/generar", ADMIN_OP, auditAction("PLANILLA_PENSIONADOS", "GENERAR", (req) => `Generar nomina planilla ${req.params.id}`), controller.generar);
router.post("/:id/cerrar",  ADMIN_OP, auditAction("PLANILLA_PENSIONADOS", "CERRAR",  (req) => `Cerrar planilla ${req.params.id}`),   controller.cerrar);
router.post("/:id/reversar", ADMIN_OP, auditAction("PLANILLA_PENSIONADOS", "REVERSAR", (req) => `Reversar planilla ${req.params.id}`), controller.reversar);
router.post("/:id/jubilados/:jid/reversar", ADMIN_OP, auditAction("PLANILLA_PENSIONADOS", "REVERSAR_JUBILADO", (req) => `Reversar jubilado ${req.params.jid} planilla ${req.params.id}`), controller.reversarJubilado);

// Base por :id (al final para no capturar sub-rutas)
router.get("/:id",  ADMIN_OP, controller.getById);
router.put("/:id",  ADMIN_OP, auditAction("PLANILLA_PENSIONADOS", "EDITAR", (req) => `Editar planilla ${req.params.id}`), controller.update);

module.exports = router;
