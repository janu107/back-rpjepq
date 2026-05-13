const { Router } = require("express");

const prestamosController = require("../controllers/prestamos.controller");
const detalleController = require("../controllers/detallePrestamos.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();
router.use(authMiddleware);

router.post("/calcular-cuota", prestamosController.calculate);
router.get("/", prestamosController.list);
router.get("/:id", prestamosController.getById);
router.post("/", prestamosController.create);
router.put("/:id", prestamosController.update);
router.delete("/:id", prestamosController.remove);
router.patch("/:id/estado", prestamosController.changeStatus);

router.get("/:id/detalle", detalleController.listByPrestamo);
router.post("/:id/detalle", detalleController.createDetalle);
router.put("/detalle/:detalleId", detalleController.updateDetalle);
router.delete("/detalle/:detalleId", detalleController.removeDetalle);
router.get("/:id/saldo", detalleController.getSaldo);
router.get("/:id/total-pagado", detalleController.getTotalPagado);

module.exports = router;
