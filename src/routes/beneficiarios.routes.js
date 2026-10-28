const { Router } = require("express");

const controller = require("../controllers/beneficiarios.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

// Roles: ADMIN y OPERADOR escriben/consultan (RRHH y CONTADOR del spec -> OPERADOR).
const ADMIN_OP = authorizeRoles("ADMIN", "OPERADOR");

// --- Consultas ---
router.get("/jubilados/buscar", ADMIN_OP, controller.buscarJubilados);
router.get("/activos", ADMIN_OP, controller.getActivos);
router.get("/suspendidos", ADMIN_OP, controller.getSuspendidos);
router.get("/jubilado/:id", ADMIN_OP, controller.getByJubilado);

// --- Escritura ---
router.post("/registrar", ADMIN_OP, auditAction("BENEFICIARIOS", "REGISTRAR", (req) => `Registro de beneficiarios jubilado ${req.body?.idJubilado}`), controller.registrarLote);
router.post("/tutores/registrar", ADMIN_OP, auditAction("BENEFICIARIOS", "TUTOR", "Registro de tutora"), controller.registrarTutor);
router.put("/jubilado/:id/porcentajes", ADMIN_OP, auditAction("BENEFICIARIOS", "PORCENTAJES", (req) => `Ajustar porcentajes de beneficiarios jubilado ${req.params.id}`), controller.actualizarPorcentajes);
router.put("/:id", ADMIN_OP, auditAction("BENEFICIARIOS", "EDITAR", (req) => `Editar beneficiario ${req.params.id}`), controller.actualizar);
router.post("/:id/suspender", ADMIN_OP, auditAction("BENEFICIARIOS", "SUSPENDER", (req) => `Suspender beneficiario ${req.params.id}`), controller.suspender);
router.post("/:id/reactivar", ADMIN_OP, auditAction("BENEFICIARIOS", "REACTIVAR", (req) => `Reactivar beneficiario ${req.params.id}`), controller.reactivar);
router.delete("/:id", authorizeRoles("ADMIN"), auditAction("BENEFICIARIOS", "ELIMINAR", (req) => `Eliminar beneficiario ${req.params.id}`), controller.remove);

module.exports = router;
