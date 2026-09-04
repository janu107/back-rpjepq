const { Router } = require("express");

const controller = require("../controllers/impresiones.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);
router.use(authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"));

// --- Vistas previas en pantalla (JSON) --------------------------------------
router.get("/nomina-sueldos/:idPlanilla", controller.previewNominaSueldos);
router.get("/nomina-tiempo-extra/:idPlanilla", controller.previewNominaTiempoExtra);
router.get("/prestamo/:idPrestamo/estado-cuenta", controller.previewEstadoCuenta);
router.get("/resumen", controller.previewResumen);
router.get("/nomina-prestamos", controller.previewNominaPrestamos);

// --- Impresiones PDF ---------------------------------------------------------
router.get("/nomina-sueldos/:idPlanilla/pdf",
  auditAction("IMPRESIONES", "NOMINA_SUELDOS_PDF", (req) => `Imprimir nómina de sueldos de la planilla ${req.params.idPlanilla}`),
  controller.pdfNominaSueldos);

router.get("/nomina-tiempo-extra/:idPlanilla/pdf",
  auditAction("IMPRESIONES", "NOMINA_TIEMPO_EXTRA_PDF", (req) => `Imprimir nómina de tiempo extra de la planilla ${req.params.idPlanilla}`),
  controller.pdfNominaTiempoExtra);

router.get("/prestamo/:idPrestamo/estado-cuenta/pdf",
  auditAction("IMPRESIONES", "ESTADO_CUENTA_PRESTAMO_PDF", (req) => `Imprimir estado de cuenta del préstamo ${req.params.idPrestamo}`),
  controller.pdfEstadoCuenta);

router.get("/resumen/pdf",
  auditAction("IMPRESIONES", "RESUMEN_PDF", (req) => `Imprimir resumen (manejo ${req.query?.tipoManejo}) del ${req.query?.desde} al ${req.query?.hasta}`),
  controller.pdfResumen);

router.get("/nomina-prestamos/pdf",
  auditAction("IMPRESIONES", "NOMINA_PRESTAMOS_PDF", (req) => `Imprimir nómina de préstamos EPQ del ${req.query?.desde} al ${req.query?.hasta}`),
  controller.pdfNominaPrestamos);

module.exports = router;
