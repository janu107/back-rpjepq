const { Router } = require("express");

const controller = require("../controllers/reportesJubilados.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

// Reportes y dashboard: lectura para ADMIN, OPERADOR y CONSULTA.
const LECTURA = authorizeRoles("ADMIN", "OPERADOR", "CONSULTA");

router.get("/dashboard", LECTURA, controller.dashboard);
router.get("/saldos", LECTURA, controller.saldos);
router.get("/pagos", LECTURA, controller.pagos);
router.get("/beneficiarios-activos", LECTURA, controller.beneficiariosActivos);
router.get("/convenios", LECTURA, controller.convenios);
router.get("/deuda-por-tipo", LECTURA, controller.deudaPorTipo);
router.get("/amparistas", LECTURA, controller.amparistas);

module.exports = router;
