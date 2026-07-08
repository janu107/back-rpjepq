const { Router } = require("express");

const controller = require("../controllers/jubiladosModulo.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

// Se monta en /jubilados ANTES del router de mantenimiento (jubilados.routes).
// Solo define rutas específicas (buscar, no-amparistas, /:id/... y fallecimiento).
// NO define GET /:id, así que el CRUD de mantenimiento sigue funcionando por
// fall-through de Express.
const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");
const LECTURA = authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"); // consultas: CONSULTA solo lectura

router.get("/buscar", LECTURA, controller.buscar);
router.get("/no-amparistas", LECTURA, controller.noAmparistas);
router.get("/:id/deuda-total", LECTURA, controller.deudaTotal);
router.get("/:id/beneficiarios-registrados", LECTURA, controller.beneficiariosRegistrados);
router.get("/:id/beneficiarios-activos", LECTURA, controller.beneficiariosActivos);
router.get("/:id/resumen-financiero", LECTURA, controller.resumenFinanciero);
router.get("/:id/ultimos-pagos", LECTURA, controller.ultimosPagos);
router.get("/:id/deuda-detalle", LECTURA, controller.deudaDetalle);
router.get("/:id/historia-completa", LECTURA, controller.historiaCompleta);
router.get("/:id/estado-cuenta.pdf", LECTURA, controller.estadoCuentaPdf);
router.post("/:id/fallecimiento", ADMIN_OP, auditAction("JUBILADOS", "FALLECIMIENTO", (req) => `Registrar fallecimiento jubilado ${req.params.id}`), controller.fallecimiento);

module.exports = router;
