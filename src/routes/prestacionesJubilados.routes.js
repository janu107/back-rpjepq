const { Router } = require("express");
const controller = require("../controllers/prestacionesJubilados.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");
const CONSULTA = authorizeRoles("ADMIN", "OPERADOR", "CONSULTA");

// --- Rutas fijas (antes de /:tipo para no ser capturadas) ------------------
router.get("/planilla/:id", ADMIN_OP, controller.getById);
router.get("/planilla/:id/detalle", ADMIN_OP, controller.getDetalle);
router.get("/planilla/:id/candidatos-jubilados", ADMIN_OP, controller.getCandidatosJubilados);
router.get("/planilla/:id/candidatos-beneficiarios", ADMIN_OP, controller.getCandidatosBeneficiarios);
router.get("/planilla/:id/resumen-tipo-jubilacion", CONSULTA, controller.getResumenPorTipoJubilacion);
router.get("/planilla/:id/export/excel", CONSULTA, controller.exportExcel);
router.post("/planilla/:id/agregar", ADMIN_OP,
  auditAction("PRESTACIONES_JUBILADOS", "AGREGAR", (req) => `Agregar registro a planilla ${req.params.id}`),
  controller.agregar);
router.post("/planilla/:id/cerrar", ADMIN_OP,
  auditAction("PRESTACIONES_JUBILADOS", "CERRAR", (req) => `Cerrar planilla ${req.params.id}`),
  controller.cerrar);

router.put("/linea/:idLinea/monto", ADMIN_OP,
  auditAction("PRESTACIONES_JUBILADOS", "EDITAR", (req) => `Editar monto del renglón ${req.params.idLinea}`),
  controller.editarMonto);
router.delete("/linea/:idLinea", ADMIN_OP,
  auditAction("PRESTACIONES_JUBILADOS", "ELIMINAR", (req) => `Eliminar renglón ${req.params.idLinea}`),
  controller.eliminarLinea);

// --- Por tipo de prestación: bono14 | aguinaldo -----------------------------
router.get("/:tipo", ADMIN_OP, controller.list);
router.post("/:tipo", ADMIN_OP,
  auditAction("PRESTACIONES_JUBILADOS", "CREAR", (req) => `Crear planilla de ${req.params.tipo} jubilados`),
  controller.create);
router.get("/:tipo/preview", ADMIN_OP, controller.preview);
router.post("/:tipo/generar", ADMIN_OP,
  auditAction("PRESTACIONES_JUBILADOS", "GENERAR", (req) => `Generar ${req.params.tipo} jubilados planilla ${req.body?.idPlanilla}`),
  controller.generar);
router.post("/:tipo/revertir/:id", ADMIN_OP,
  auditAction("PRESTACIONES_JUBILADOS", "REVERSAR", (req) => `Revertir ${req.params.tipo} jubilados planilla ${req.params.id}`),
  controller.revertir);

module.exports = router;
