const { Router } = require("express");
const controller = require("../controllers/dietas.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");
const router = Router();
router.use(authMiddleware);

const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");

// Maestro-detalle (antes de /:id para no capturar sub-rutas).
router.get("/pagos", ADMIN_OP, controller.pagosDelMes);
router.post("/recalcular", ADMIN_OP, auditAction("DIETAS", "RECALCULAR", "Recalcular pagos del mes"), controller.recalcular);

router.get("/", ADMIN_OP, controller.list);
router.get("/:id/detalle", ADMIN_OP, controller.detalle);
router.get("/:id", ADMIN_OP, controller.getById);
// El encabezado de dieta NO se crea/edita libremente: se genera desde el flujo de
// sesiones (asistencia) y su estado/montos cambian solo por /pagar, /recibir y /recalcular.
// Esto evita saltarse la máquina de estados PENDIENTE->PAGADO->RECIBIDO y desincronizar
// el maestro-detalle. (Hallazgo de revisión: bypass de estados/montos vía PUT genérico.)
router.post("/:id/pagar", ADMIN_OP, auditAction("DIETAS", "PAGAR", (req) => `Emitir pago dieta ${req.params.id}`), controller.pagar);
router.post("/:id/recibir", ADMIN_OP, auditAction("DIETAS", "RECIBIR", (req) => `Marcar recibido dieta ${req.params.id}`), controller.recibir);

module.exports = router;
