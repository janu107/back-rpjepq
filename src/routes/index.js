const { Router } = require("express");

const authRoutes = require("./auth.routes");
const catalogosRoutes = require("./catalogos.routes");
const aportacionesRoutes = require("./aportaciones.routes");
const empleadosRoutes = require("./empleados.routes");
const healthRoutes = require("./health.routes");
const jubiladosRoutes = require("./jubilados.routes");
const juntaDirectivaRoutes = require("./juntaDirectiva.routes");
const prestamosRoutes = require("./prestamos.routes");
const rolesRoutes = require("./roles.routes");
const salariosRoutes = require("./salarios.routes");
const tiempoExtraRoutes = require("./tiempoExtra.routes");
const dietasRoutes = require("./dietas.routes");
const otrosDescuentosRoutes = require("./otrosDescuentos.routes");
const nominaRoutes = require("./nomina.routes");
const usuariosRoutes = require("./usuarios.routes");
const generacionPlanillaRoutes = require("./generacionPlanilla.routes");
const reportesNominaRoutes = require("./reportesNomina.routes");
const auditoriaRoutes = require("./auditoria.routes");
const backupRoutes = require("./backup.routes");
const systemRoutes = require("./system.routes");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();

const baseProtectedResponse = (message) => (req, res) => {
  res.json({
    ok: true,
    message,
    data: []
  });
};

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/usuarios", usuariosRoutes);
router.use("/roles", rolesRoutes);
router.use("/catalogos", catalogosRoutes);
router.use("/aportaciones", aportacionesRoutes);
router.use("/empleados", empleadosRoutes);
router.use("/jubilados", jubiladosRoutes);
router.use("/junta-directiva", juntaDirectivaRoutes);
router.use("/prestamos", prestamosRoutes);
router.use("/salarios", salariosRoutes);
router.use("/tiempo-extra", tiempoExtraRoutes);
router.use("/dietas", dietasRoutes);
router.use("/otros-descuentos", otrosDescuentosRoutes);
router.use("/nomina", nominaRoutes);
router.use("/generacion-planilla", generacionPlanillaRoutes);
router.use("/reportes/nomina", reportesNominaRoutes);
router.use("/auditoria", auditoriaRoutes);
router.use("/backup", backupRoutes);
router.use("/system", systemRoutes);

module.exports = router;
