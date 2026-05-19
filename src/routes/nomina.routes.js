const { Router } = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const ingresos = require("../controllers/nominaIngresos.controller");
const descuentos = require("../controllers/nominaDescuentos.controller");
const resumen = require("../controllers/nominaResumen.controller");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

router.get("/ingresos/total/:idPlanilla", authorizeRoles("ADMIN", "OPERADOR"), ingresos.total);
router.get("/ingresos", authorizeRoles("ADMIN", "OPERADOR"), ingresos.list);
router.get("/ingresos/:id", authorizeRoles("ADMIN", "OPERADOR"), ingresos.getById);
router.post("/ingresos", authorizeRoles("ADMIN", "OPERADOR"), auditAction("NOMINA", "CREAR_INGRESO"), ingresos.create);
router.put("/ingresos/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("NOMINA", "EDITAR_INGRESO"), ingresos.update);
router.delete("/ingresos/:id", authorizeRoles("ADMIN"), auditAction("NOMINA", "ELIMINAR_INGRESO"), ingresos.remove);

router.get("/descuentos/total/:idPlanilla", authorizeRoles("ADMIN", "OPERADOR"), descuentos.total);
router.get("/descuentos", authorizeRoles("ADMIN", "OPERADOR"), descuentos.list);
router.get("/descuentos/:id", authorizeRoles("ADMIN", "OPERADOR"), descuentos.getById);
router.post("/descuentos", authorizeRoles("ADMIN", "OPERADOR"), auditAction("NOMINA", "CREAR_DESCUENTO"), descuentos.create);
router.put("/descuentos/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("NOMINA", "EDITAR_DESCUENTO"), descuentos.update);
router.delete("/descuentos/:id", authorizeRoles("ADMIN"), auditAction("NOMINA", "ELIMINAR_DESCUENTO"), descuentos.remove);

router.get("/resumen/planilla/:idPlanilla", authorizeRoles("ADMIN", "OPERADOR"), resumen.porPlanilla);
router.get("/resumen/empleado/:idEmpleado", authorizeRoles("ADMIN", "OPERADOR"), resumen.porEmpleado);
router.get("/resumen/jubilado/:idJubilado", authorizeRoles("ADMIN", "OPERADOR"), resumen.porJubilado);

module.exports = router;
