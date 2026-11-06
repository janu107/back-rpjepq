const { Router } = require("express");

const prestamosController = require("../controllers/prestamos.controller");
const detalleController = require("../controllers/detallePrestamos.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");
const multer = require("multer");
const carga = require("../services/cargaPrestamos.service");
const { successResponse } = require("../utils/response");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

// Carga masiva de pagos (antes de "/:id").
router.get("/carga-masiva/plantilla", authorizeRoles("ADMIN", "OPERADOR"), async (req, res, next) => {
  try {
    const { buffer, filename } = await carga.plantilla();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(Buffer.from(buffer));
  } catch (e) { next(e); }
});
router.post("/carga-masiva", authorizeRoles("ADMIN", "OPERADOR"), upload.single("archivo"), auditAction("PRESTAMOS", "CARGA_MASIVA", "Carga masiva de pagos de préstamos"),
  async (req, res, next) => { try { return successResponse(res, await carga.cargaMasiva(req.file?.buffer, req.user), "Carga masiva procesada", 201); } catch (e) { next(e); } });
// Pago individual con el cálculo de la carga masiva: { fechaPago, monto }.
router.post("/:id/pago-individual", authorizeRoles("ADMIN", "OPERADOR"), auditAction("PRESTAMOS", "PAGO_INDIVIDUAL", (req) => `Pago individual préstamo ${req.params.id}`),
  async (req, res, next) => { try { return successResponse(res, await carga.pagoIndividual(req.params.id, req.body, req.user), "Pago registrado", 201); } catch (e) { next(e); } });
// Vista previa del cálculo de un pago: { fechaPago, monto }.
router.post("/:id/detalle/calcular", authorizeRoles("ADMIN", "OPERADOR"), async (req, res, next) => {
  try { return successResponse(res, await carga.calcular(req.params.id, req.body), "Pago calculado"); } catch (e) { next(e); }
});
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
