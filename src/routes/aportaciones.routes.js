const { Router } = require("express");

const aportacionesController = require("../controllers/aportaciones.controller");
const detalleController = require("../controllers/detalleAportaciones.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();
router.use(authMiddleware);

router.get("/", aportacionesController.list);
router.get("/:id", aportacionesController.getById);
router.post("/", aportacionesController.create);
router.put("/:id", aportacionesController.update);
router.delete("/:id", aportacionesController.remove);
router.patch("/:id/estado", aportacionesController.changeStatus);

router.get("/:id/detalle", detalleController.listByAportacion);
router.post("/:id/detalle", detalleController.createDetalle);
router.put("/detalle/:detalleId", detalleController.updateDetalle);
router.delete("/detalle/:detalleId", detalleController.removeDetalle);
router.get("/:id/total", detalleController.getTotal);

module.exports = router;
