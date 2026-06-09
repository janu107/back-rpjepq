const { Router } = require("express");

const controller = require("../controllers/reportesRegimen.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);
router.use(authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"));
router.get("/prestamos-regimen", controller.prestamosRegimen);
router.get("/junta-directiva", controller.juntaDirectiva);
router.get("/dietas", controller.dietas);
router.get("/empleados-regimen", controller.empleadosRegimen);
router.get("/aportaciones", controller.aportaciones);

module.exports = router;
