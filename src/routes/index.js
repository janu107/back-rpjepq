const express = require("express");
const fs = require("fs");
const path = require("path");
const { Router } = express;

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
const sesionesRoutes = require("./sesiones.routes");
const nominaTiempoExtraRoutes = require("./nominaTiempoExtra.routes");
const otrosDescuentosRoutes = require("./otrosDescuentos.routes");
const nominaRoutes = require("./nomina.routes");
const usuariosRoutes = require("./usuarios.routes");
const generacionPlanillaRoutes = require("./generacionPlanilla.routes");
const reportesNominaRoutes = require("./reportesNomina.routes");
const descuentosJudicialesRoutes = require("./descuentosJudiciales.routes");
const prestamosRegimenRoutes = require("./prestamosRegimen.routes");
const datosPlanillaRoutes = require("./datosPlanilla.routes");
const reportesRegimenRoutes = require("./reportesRegimen.routes");
const auditoriaRoutes = require("./auditoria.routes");
const backupRoutes = require("./backup.routes");
const systemRoutes = require("./system.routes");
const planillasPensionadosRoutes = require("./planillasPensionados.routes");
const planillasTrabajadoresRoutes = require("./planillasTrabajadores.routes");
const beneficiariosRoutes = require("./beneficiarios.routes");
const jubiladosModuloRoutes = require("./jubiladosModulo.routes");
const amparistasRoutes = require("./amparistas.routes");
const conveniosRoutes = require("./convenios.routes");
const nominasJubiladosRoutes = require("./nominasJubilados.routes");
const reportesJubiladosRoutes = require("./reportesJubilados.routes");
const prestacionesRoutes = require("./prestaciones.routes");
const prestacionesJubiladosRoutes = require("./prestacionesJubilados.routes");
const impresionesRoutes = require("./impresiones.routes");
const authMiddleware = require("../middlewares/auth.middleware");
const { buscarLogo } = require("../utils/pdfLayout");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();

const baseProtectedResponse = (message) => (req, res) => {
  res.json({
    ok: true,
    message,
    data: []
  });
};

// Logo del régimen (público: se usa en el encabezado de los reportes en pantalla).
// Es el mismo archivo que imprimen los PDF: back-rpjepq/assets/logo-regimen.png
router.get("/logo", (req, res) => {
  const ruta = buscarLogo();
  if (!ruta) return res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.sendFile(ruta);
});

// Subir/reemplazar el logo desde la pantalla de Mantenimiento (sólo ADMIN), para
// no depender de copiar el archivo al servidor. Se recibe la imagen cruda.
router.post(
  "/logo",
  authMiddleware,
  authorizeRoles("ADMIN"),
  express.raw({ type: ["image/png", "image/jpeg"], limit: "3mb" }),
  (req, res) => {
    const tipo = String(req.headers["content-type"] || "");
    if (!Buffer.isBuffer(req.body) || !req.body.length || !["image/png", "image/jpeg"].includes(tipo.split(";")[0].trim())) {
      return res.status(400).json({ ok: false, message: "Envíe una imagen PNG o JPG." });
    }
    const carpeta = path.join(__dirname, "..", "..", "assets");
    fs.mkdirSync(carpeta, { recursive: true });
    ["logo-regimen.png", "logo-regimen.jpg", "logo-regimen.jpeg"]
      .forEach((n) => { try { fs.unlinkSync(path.join(carpeta, n)); } catch (_) { /* no existía */ } });
    fs.writeFileSync(path.join(carpeta, tipo.includes("png") ? "logo-regimen.png" : "logo-regimen.jpg"), req.body);
    return res.json({ ok: true, message: "Logo actualizado correctamente." });
  }
);

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/usuarios", usuariosRoutes);
router.use("/roles", rolesRoutes);
router.use("/catalogos", catalogosRoutes);
router.use("/aportaciones", aportacionesRoutes);
router.use("/empleados", empleadosRoutes);
router.use("/jubilados", jubiladosModuloRoutes);
router.use("/jubilados", jubiladosRoutes);
router.use("/junta-directiva", juntaDirectivaRoutes);
router.use("/prestamos", prestamosRoutes);
router.use("/salarios", salariosRoutes);
router.use("/tiempo-extra", tiempoExtraRoutes);
router.use("/dietas", dietasRoutes);
router.use("/sesiones", sesionesRoutes);
router.use("/nomina-tiempo-extra", nominaTiempoExtraRoutes);
router.use("/prestaciones", prestacionesRoutes);
router.use("/prestaciones-jubilados", prestacionesJubiladosRoutes);
router.use("/impresiones", impresionesRoutes);
router.use("/otros-descuentos", otrosDescuentosRoutes);
router.use("/nomina", nominaRoutes);
router.use("/generacion-planilla", generacionPlanillaRoutes);
router.use("/reportes/nomina", reportesNominaRoutes);
router.use("/descuentos-judiciales", descuentosJudicialesRoutes);
router.use("/prestamos-regimen", prestamosRegimenRoutes);
router.use("/datos-planilla", datosPlanillaRoutes);
router.use("/reportes/regimen", reportesRegimenRoutes);
router.use("/auditoria", auditoriaRoutes);
router.use("/backup", backupRoutes);
router.use("/system", systemRoutes);
router.use("/planillas-pensionados", planillasPensionadosRoutes);
router.use("/planillas-trabajadores", planillasTrabajadoresRoutes);
router.use("/beneficiarios", beneficiariosRoutes);
router.use("/amparistas", amparistasRoutes);
router.use("/convenios", conveniosRoutes);
router.use("/nominas", nominasJubiladosRoutes);
router.use("/jubilados-reportes", reportesJubiladosRoutes);

module.exports = router;
