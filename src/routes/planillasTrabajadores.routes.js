const { Router } = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const controller = require("../controllers/planillasTrabajadores.controller");

const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");

// Planillas CRUD
router.get("/",   ADMIN_OP, controller.list);
router.post("/",  ADMIN_OP, auditAction("PLANILLA_EMPLEADOS", "CREAR", "Crear planilla empleados"), controller.create);

// Rutas por :id con sub-rutas específicas (antes del GET /:id base)
router.get("/:id/preview",       ADMIN_OP, controller.preview);
router.get("/:id/detalle",       ADMIN_OP, controller.getDetalle);
router.get("/:id/export/excel",  ADMIN_OP, controller.exportExcel);
router.get("/:id/export/banco",  ADMIN_OP, controller.exportBanco);

router.post("/:id/generar",  ADMIN_OP, auditAction("PLANILLA_EMPLEADOS", "GENERAR", (req) => `Generar nomina planilla ${req.params.id}`), controller.generar);
router.post("/:id/cerrar",   ADMIN_OP, auditAction("PLANILLA_EMPLEADOS", "CERRAR",  (req) => `Cerrar planilla ${req.params.id}`),   controller.cerrar);
router.post("/:id/reversar", ADMIN_OP, auditAction("PLANILLA_EMPLEADOS", "REVERSAR", (req) => `Reversar planilla ${req.params.id}`), controller.reversar);
router.post("/:id/empleados/:eid/reversar", ADMIN_OP, auditAction("PLANILLA_EMPLEADOS", "REVERSAR_EMPLEADO", (req) => `Reversar empleado ${req.params.eid} planilla ${req.params.id}`), controller.reversarEmpleado);

// Edición de montos (CAMBIO X) — sólo si la planilla no está cerrada
router.get("/:id/empleados/:eid/montos", ADMIN_OP, controller.getMontos);
router.put("/:id/empleados/:eid/montos", ADMIN_OP, auditAction("PLANILLA_EMPLEADOS", "EDITAR_MONTOS", (req) => `Editar montos empleado ${req.params.eid} planilla ${req.params.id}`), controller.editarMontos);

// Base por :id (al final para no capturar sub-rutas)
router.get("/:id",  ADMIN_OP, controller.getById);
router.put("/:id",  ADMIN_OP, auditAction("PLANILLA_EMPLEADOS", "EDITAR", (req) => `Editar planilla ${req.params.id}`), controller.update);

module.exports = router;
