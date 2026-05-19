const { Router } = require("express");

const aportacionesController = require("../controllers/aportaciones.controller");
const detalleController = require("../controllers/detalleAportaciones.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

router.get("/", authorizeRoles("ADMIN", "OPERADOR"), aportacionesController.list);
router.get("/:id", authorizeRoles("ADMIN", "OPERADOR"), aportacionesController.getById);
router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction("APORTACIONES", "CREAR", "Creacion de aportacion"), aportacionesController.create);
router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("APORTACIONES", "EDITAR", (req) => `Edicion aportacion ${req.params.id}`), aportacionesController.update);
router.delete("/:id", authorizeRoles("ADMIN"), auditAction("APORTACIONES", "ELIMINAR", (req) => `Eliminacion aportacion ${req.params.id}`), aportacionesController.remove);
router.patch("/:id/estado", authorizeRoles("ADMIN", "OPERADOR"), auditAction("APORTACIONES", "CAMBIO_ESTADO", (req) => `Cambio estado aportacion ${req.params.id}`), aportacionesController.changeStatus);

router.get("/:id/detalle", authorizeRoles("ADMIN", "OPERADOR"), detalleController.listByAportacion);
router.post("/:id/detalle", authorizeRoles("ADMIN", "OPERADOR"), auditAction("APORTACIONES", "CREAR_DETALLE"), detalleController.createDetalle);
router.put("/detalle/:detalleId", authorizeRoles("ADMIN", "OPERADOR"), auditAction("APORTACIONES", "EDITAR_DETALLE"), detalleController.updateDetalle);
router.delete("/detalle/:detalleId", authorizeRoles("ADMIN"), auditAction("APORTACIONES", "ELIMINAR_DETALLE"), detalleController.removeDetalle);
router.get("/:id/total", authorizeRoles("ADMIN", "OPERADOR"), detalleController.getTotal);

module.exports = router;
