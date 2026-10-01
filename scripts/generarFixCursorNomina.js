/**
 * Genera la migración que corrige el cierre prematuro del cursor en los SP de
 * nómina de jubilados.
 *
 * El problema: los tres SP declaran
 *     DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
 * para saber cuándo se acabó el cursor, pero ese mismo handler se dispara con
 * CUALQUIER "SELECT ... INTO" sin filas dentro del ciclo. La búsqueda de deuda
 * pendiente no encuentra nada para la mayoría de jubilados, así que marca
 * v_done = TRUE y el ciclo termina después del PRIMER jubilado.
 *
 * La corrección es una sola línea por SP: reponer v_done = FALSE al final del
 * cuerpo del ciclo, de modo que sólo el FETCH pueda terminarlo. No se toca nada
 * de la lógica de montos: el cuerpo se toma tal cual está en la base y se le
 * inserta esa línea, para no transcribir cálculos a mano.
 *
 * Uso:  node scripts/generarFixCursorNomina.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

// SP -> etiqueta del ciclo que hay que proteger
const OBJETIVOS = {
  sp_generar_nomina_pensionados: "loop_jub",
  sp_generar_nomina_amparistas: "loop_amp",
  sp_generar_nomina_beneficiarios: "loop_ben"
};

const tipoParam = (p) => `${p.PARAMETER_MODE} ${p.PARAMETER_NAME} ${p.DTD_IDENTIFIER}`;

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, port: Number(process.env.DB_PORT)
  });

  const partes = [];
  for (const [nombre, etiqueta] of Object.entries(OBJETIVOS)) {
    const [[rutina]] = await conn.query(
      "SELECT ROUTINE_DEFINITION d FROM information_schema.routines WHERE routine_schema=DATABASE() AND routine_name=?",
      [nombre]
    );
    if (!rutina) throw new Error(`No existe el procedimiento ${nombre}`);

    const [params] = await conn.query(
      `SELECT PARAMETER_NAME, PARAMETER_MODE, DTD_IDENTIFIER FROM information_schema.parameters
        WHERE specific_schema=DATABASE() AND specific_name=? AND PARAMETER_NAME IS NOT NULL
        ORDER BY ordinal_position`,
      [nombre]
    );

    const marca = `END LOOP ${etiqueta};`;
    if (!rutina.d.includes(marca)) throw new Error(`No se encontró "${marca}" en ${nombre}`);
    if (rutina.d.includes("-- FIX cursor")) throw new Error(`${nombre} ya tiene la corrección`);

    const reposicion = [
      "",
      "        -- FIX cursor: el handler NOT FOUND es compartido, y la búsqueda de deuda",
      "        -- pendiente lo dispara cuando el jubilado no debe nada. Sin esta línea el",
      "        -- ciclo terminaba después del primer jubilado sin deuda.",
      "        SET v_done = FALSE;",
      `    ${marca}`
    ].join("\n");

    const cuerpo = rutina.d.replace(marca, reposicion.trimStart().replace(/^/, "  "));

    partes.push(
      `DROP PROCEDURE IF EXISTS ${nombre};\nDELIMITER $$\n\n` +
      `CREATE PROCEDURE ${nombre}(\n    ${params.map(tipoParam).join(",\n    ")}\n)\n${cuerpo} $$\n\nDELIMITER ;\n`
    );
  }

  const cabecera = [
    "-- ============================================================================",
    "-- MIGRACIÓN — Cierre prematuro del cursor en los SP de nómina de jubilados",
    "-- Base de datos : apps_rpjepq",
    "--",
    "-- SÍNTOMA: la nómina procesaba un solo jubilado aunque hubiera varios aptos.",
    "--",
    "-- CAUSA: los tres SP usan",
    "--     DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;",
    "-- para detectar el fin del cursor, pero ese handler también se dispara con",
    "-- cualquier SELECT ... INTO sin filas dentro del ciclo. La consulta de deuda",
    "-- pendiente no encuentra filas para la mayoría de jubilados, así que marcaba",
    "-- v_done = TRUE y el ciclo salía tras el PRIMER jubilado sin deuda.",
    "--",
    "-- CORRECCIÓN: reponer v_done = FALSE al final del cuerpo del ciclo, para que",
    "-- sólo el FETCH pueda terminarlo. La lógica de montos no se toca: el cuerpo de",
    "-- cada SP se tomó tal cual de la base (ver scripts/generarFixCursorNomina.js).",
    "--",
    "-- Generado automáticamente. Idempotente: se puede volver a correr.",
    "-- ============================================================================",
    "",
    "USE `apps_rpjepq`;",
    "",
    "SELECT 'Corrigiendo cursores de nomina de jubilados' AS etapa;",
    ""
  ].join("\n");

  const verificacion = [
    "",
    "SELECT ROUTINE_NAME, ",
    "       CASE WHEN ROUTINE_DEFINITION LIKE '%FIX cursor%' THEN 'CORREGIDO' ELSE 'SIN CORREGIR' END AS estado",
    "  FROM information_schema.ROUTINES",
    " WHERE ROUTINE_SCHEMA = DATABASE()",
    "   AND ROUTINE_NAME IN ('sp_generar_nomina_pensionados','sp_generar_nomina_amparistas','sp_generar_nomina_beneficiarios')",
    " ORDER BY ROUTINE_NAME;",
    "",
    "SELECT 'MIGRACION COMPLETADA' AS resultado;",
    ""
  ].join("\n");

  const destino = path.join(__dirname, "..", "sql", "migraciones", "migration_fix_cursor_nomina_jubilados.sql");
  fs.writeFileSync(destino, cabecera + partes.join("\n") + verificacion, "utf8");
  console.log("Migración escrita en:", destino);

  await conn.end();
})();
