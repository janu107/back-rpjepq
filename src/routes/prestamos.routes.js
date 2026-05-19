const { Router } = require("express");

const prestamosController = require("../controllers/prestamos.controller");
const detalleController = require("../controllers/detallePrestamos.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);

router.post("/calcular-cuota", authorizeRoles("ADMIN", "OPERADOR"), prestamosController.calculate);
router.get("/", authorizeRoles("ADMIN", "OPERADOR"), prestamosController.list);
router.get("/:id", authorizeRoles("ADMIN", "OPERADOR"), prestamosController.getById);
router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction("PRESTAMOS", "CREAR", "Creacion de prestamo"), prestamosController.create);
router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("PRESTAMOS", "EDITAR", (req) => `Edicion prestamo ${req.params.id}`), prestamosController.update);
router.delete("/:id", authorizeRoles("ADMIN"), auditAction("PRESTAMOS", "ELIMINAR", (req) => `Eliminacion prestamo ${req.params.id}`), prestamosController.remove);
router.patch("/:id/estado", authorizeRoles("ADMIN", "OPERADOR"), auditAction("PRESTAMOS", "CAMBIO_ESTADO", (req) => `Cambio estado prestamo ${req.params.id}`), prestamosController.changeStatus);

router.get("/:id/detalle", authorizeRoles("ADMIN", "OPERADOR"), detalleController.listByPrestamo);
router.post("/:id/detalle", authorizeRoles("ADMIN", "OPERADOR"), auditAction("PRESTAMOS", "CREAR_DETALLE"), detalleController.createDetalle);
router.put("/detalle/:detalleId", authorizeRoles("ADMIN", "OPERADOR"), auditAction("PRESTAMOS", "EDITAR_DETALLE"), detalleController.updateDetalle);
router.delete("/detalle/:detalleId", authorizeRoles("ADMIN"), auditAction("PRESTAMOS", "ELIMINAR_DETALLE"), detalleController.removeDetalle);
router.get("/:id/saldo", authorizeRoles("ADMIN", "OPERADOR"), detalleController.getSaldo);
router.get("/:id/total-pagado", authorizeRoles("ADMIN", "OPERADOR"), detalleController.getTotalPagado);

module.exports = router;
