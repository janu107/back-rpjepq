/**
 * Genera un PDF con todos los scripts SQL del módulo de Planilla de Pensionados.
 * Uso: node scripts/generarPdfScripts.js
 */
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(ROOT, "..", "Scripts_Nomina_Pensionados.pdf");

const scriptA = fs.readFileSync(path.join(ROOT, "sql/migraciones/migration_parametro_general_igss.sql"), "utf8");
const scriptB = fs.readFileSync(path.join(ROOT, "sql/migraciones/migration_pensionados.sql"), "utf8");

const diagnostico = `-- Consulta de verificacion de datos prerrequisito.
-- Cada fila debe devolver un valor > 0 antes de generar nomina.

SELECT 'Tipo ingreso PENSION' AS verificacion,
       COUNT(*) AS cantidad FROM RPJ_CAT_TIPO_INGRESO
WHERE UPPER(tin_tipo_ingreso) = 'PENSION'
UNION ALL
SELECT 'Tipo desc IGSS', COUNT(*) FROM RPJ_CAT_TIPO_DESCUENTO
WHERE UPPER(tde_tipo_descuento) = 'IGSS'
UNION ALL
SELECT 'Tipo desc ISR', COUNT(*) FROM RPJ_CAT_TIPO_DESCUENTO
WHERE UPPER(tde_tipo_descuento) = 'ISR'
UNION ALL
SELECT 'Tipo desc PRESTAMO', COUNT(*) FROM RPJ_CAT_TIPO_DESCUENTO
WHERE UPPER(tde_tipo_descuento) IN ('PRESTAMO','PRESTAMOS')
UNION ALL
SELECT 'Tipo desc JUDICIAL', COUNT(*) FROM RPJ_CAT_TIPO_DESCUENTO
WHERE UPPER(tde_tipo_descuento) IN ('JUDICIAL','JUDICIALES')
UNION ALL
SELECT 'Parametro IGSS/ISR con valor', COUNT(*) FROM RPJ_CAT_PARAMETRO_GENERAL
WHERE par_igss > 0 OR par_isr > 0
UNION ALL
SELECT 'Jubilados activos tipo 2', COUNT(*) FROM RPJ_MNT_JUBILADO
WHERE jub_tipo_manejo = 2 AND UPPER(COALESCE(jub_estado,'')) = 'ACTIVO'
UNION ALL
SELECT 'Jubilados con dat_aplica_nomina', COUNT(DISTINCT dat_id_empleado)
FROM RPJ_MNT_DATOS_PLANILLA WHERE dat_tipo_manejo = 2 AND dat_aplica_nomina = 1
UNION ALL
SELECT 'Jubilados con salario PENSION', COUNT(DISTINCT s.sal_id_jubilado)
FROM RPJ_MNT_SALARIO s
JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = s.sal_tipo_ingreso
WHERE UPPER(ti.tin_tipo_ingreso) = 'PENSION' AND s.sal_id_jubilado IS NOT NULL;`;

const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 40, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));

const BLUE = "#1565c0";
const GREY = "#555555";

// ---------- Portada ----------
doc.font("Helvetica-Bold").fontSize(26).fillColor(BLUE)
  .text("Scripts SQL — Módulo de Nómina de Pensionados", { align: "center" });
doc.moveDown(0.5);
doc.font("Helvetica").fontSize(13).fillColor(GREY)
  .text("Sistema Administrativo RPJEPQ — Base de datos apps_rpjepq", { align: "center" });
doc.moveDown(0.3);
doc.fontSize(11).fillColor("#000")
  .text("Documento de despliegue a producción", { align: "center" });
doc.moveDown(1.5);

doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text("Orden de ejecución:");
doc.moveDown(0.4);
doc.font("Helvetica").fontSize(11).fillColor("#000").list([
  "Script 1 — Columnas IGSS / IGSS Patronal / INTECAP (ejecutar PRIMERO).",
  "Script 2 — Migración completa de Planilla de Pensionados (tablas, columnas, vistas y procedimientos).",
  "Script 3 — Consulta de verificación de datos prerrequisito (solo lectura, no modifica nada)."
], { bulletRadius: 2, textIndent: 14 });
doc.moveDown(1);

doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text("Notas importantes:");
doc.moveDown(0.4);
doc.font("Helvetica").fontSize(11).fillColor("#000").list([
  "Los scripts 1 y 2 son idempotentes: pueden ejecutarse más de una vez sin duplicar ni romper datos.",
  "Compatibles con MariaDB / MySQL 8. Ejecutar en phpMyAdmin sobre la base apps_rpjepq.",
  "Tras ejecutar los scripts: reiniciar el backend (node server.js) y reconstruir el frontend (npm run build).",
  "Hacer respaldo de la base de datos antes de aplicar cambios."
], { bulletRadius: 2, textIndent: 14 });

const sections = [
  { title: "SCRIPT 1 — Columnas IGSS / IGSS Patronal / INTECAP", file: "migration_parametro_general_igss.sql", body: scriptA },
  { title: "SCRIPT 2 — Migración completa de Planilla de Pensionados", file: "migration_pensionados.sql", body: scriptB },
  { title: "SCRIPT 3 — Verificación de datos prerrequisito (solo lectura)", file: "diagnostico_pensionados.sql", body: diagnostico }
];

sections.forEach((sec) => {
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(15).fillColor(BLUE).text(sec.title);
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(GREY).text("Archivo: " + sec.file);
  doc.moveDown(0.6);
  doc.font("Courier").fontSize(8).fillColor("#000")
    .text(sec.body, { lineGap: 1.2 });
});

// ---------- Numeración de páginas ----------
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  doc.font("Helvetica").fontSize(8).fillColor(GREY)
    .text(`Página ${i + 1} de ${range.count}`, 40, doc.page.height - 25, {
      align: "right", width: doc.page.width - 80, lineBreak: false
    });
}

doc.end();
console.log("PDF generado en: " + OUT);
