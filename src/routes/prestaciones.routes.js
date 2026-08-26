const { Router } = require("express");
const controller = require("../controllers/prestaciones.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

// Generar y revertir son operaciones de nómina: sólo ADMIN y OPERADOR (el rol
// CONTADOR del spec corresponde a OPERADOR en este sistema).
const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");
const CONSULTA = authorizeRoles("ADMIN", "OPERADOR", "CONSULTA");

// --- Reportes y rutas fijas (van ANTES de /:tipo para no ser capturadas) -----
router.get("/reportes/resumen-anual", CONSULTA, controller.getResumenAnual);
router.get("/reportes/excluidos-vacacional", CONSULTA, controller.getExcluidosVacacional);

// --- Operaciones sobre una planilla ya creada -------------------------------
router.get("/planilla/:id", ADMIN_OP, controller.getById);
router.get("/planilla/:id/detalle", ADMIN_OP, controller.getDetalle);
router.get("/planilla/:id/empleados-disponibles", ADMIN_OP, controller.getEmpleadosDisponibles);
router.get("/planilla/:id/export/excel", CONSULTA, controller.exportExcel);
router.get("/planilla/:id/export/banco", ADMIN_OP, controller.exportBanco);
router.post("/planilla/:id/empleado", ADMIN_OP,
  auditAction("PRESTACIONES", "AGREGAR", (req) => `Agregar empleado a planilla ${req.params.id}`),
  controller.agregarEmpleado);
router.post("/planilla/:id/cerrar", ADMIN_OP,
  auditAction("PRESTACIONES", "CERRAR", (req) => `Cerrar planilla de prestación ${req.params.id}`),
  controller.cerrar);

// --- Operaciones sobre un renglón -------------------------------------------
router.put("/linea/:idLinea/monto", ADMIN_OP,
  auditAction("PRESTACIONES", "EDITAR", (req) => `Editar monto del renglón ${req.params.idLinea}`),
  controller.editarMonto);
router.delete("/linea/:idLinea", ADMIN_OP,
  auditAction("PRESTACIONES", "ELIMINAR", (req) => `Eliminar renglón ${req.params.idLinea}`),
  controller.eliminarLinea);

// --- Por tipo de prestación: bono14 | aguinaldo | vacacional ----------------
router.get("/:tipo", ADMIN_OP, controller.list);
router.post("/:tipo", ADMIN_OP,
  auditAction("PRESTACIONES", "CREAR", (req) => `Crear planilla de ${req.params.tipo}`),
  controller.create);
router.get("/:tipo/preview", ADMIN_OP, controller.preview);
router.post("/:tipo/generar", ADMIN_OP,
  auditAction("PRESTACIONES", "GENERAR", (req) => `Generar ${req.params.tipo} planilla ${req.body?.idPlanilla}`),
  controller.generar);
router.post("/:tipo/revertir/:id", ADMIN_OP,
  auditAction("PRESTACIONES", "REVERSAR", (req) => `Revertir ${req.params.tipo} planilla ${req.params.id}`),
  controller.revertir);

module.exports = router;
