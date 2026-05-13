const { Router } = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const ingresos = require("../controllers/nominaIngresos.controller");
const descuentos = require("../controllers/nominaDescuentos.controller");
const resumen = require("../controllers/nominaResumen.controller");

const router = Router();
router.use(authMiddleware);

router.get("/ingresos/total/:idPlanilla", ingresos.total);
router.get("/ingresos", ingresos.list);
router.get("/ingresos/:id", ingresos.getById);
router.post("/ingresos", ingresos.create);
router.put("/ingresos/:id", ingresos.update);
router.delete("/ingresos/:id", ingresos.remove);

router.get("/descuentos/total/:idPlanilla", descuentos.total);
router.get("/descuentos", descuentos.list);
router.get("/descuentos/:id", descuentos.getById);
router.post("/descuentos", descuentos.create);
router.put("/descuentos/:id", descuentos.update);
router.delete("/descuentos/:id", descuentos.remove);

router.get("/resumen/planilla/:idPlanilla", resumen.porPlanilla);
router.get("/resumen/empleado/:idEmpleado", resumen.porEmpleado);
router.get("/resumen/jubilado/:idJubilado", resumen.porJubilado);

module.exports = router;
