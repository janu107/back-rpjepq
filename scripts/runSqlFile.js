/**
 * Ejecuta un archivo .sql soportando la directiva DELIMITER (necesaria para los
 * stored procedures). Uso:  node scripts/runSqlFile.js sql/migraciones/archivo.sql
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const splitStatements = (sql) => {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine;
    const trimmed = line.trim();

    if (/^DELIMITER\s+/i.test(trimmed)) {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
      delimiter = trimmed.replace(/^DELIMITER\s+/i, "").trim();
      continue;
    }

    buffer += line + "\n";

    while (buffer.trimEnd().endsWith(delimiter)) {
      const end = buffer.trimEnd();
      const stmt = end.slice(0, end.length - delimiter.length).trim();
      if (stmt) statements.push(stmt);
      buffer = "";
      break;
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());

  // Descarta bloques que solo son comentarios.
  return statements.filter((s) => s.replace(/^\s*--[^\n]*$/gm, "").trim() !== "");
};

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error("Uso: node scripts/runSqlFile.js <ruta.sql>");
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), file);
  const sql = fs.readFileSync(fullPath, "utf8");
  const statements = splitStatements(sql);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: false
  });

  let ok = 0;
  try {
    for (const stmt of statements) {
      try {
        const [rows] = await conn.query(stmt);
        ok += 1;
        if (Array.isArray(rows) && rows.length && !Buffer.isBuffer(rows)) {
          console.log(JSON.stringify(rows));
        }
      } catch (error) {
        console.error("\n>>> FALLO EN:\n" + stmt.slice(0, 400));
        console.error(">>> " + error.message);
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    await conn.end();
  }

  console.log(`\nSentencias ejecutadas: ${ok}/${statements.length}`);
})();
