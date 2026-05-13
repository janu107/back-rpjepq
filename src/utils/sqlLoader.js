const fs = require("fs");
const path = require("path");

const sqlRoot = path.resolve(__dirname, "../../sql");

const getSql = (relativePath) => {
  const fullPath = path.resolve(sqlRoot, relativePath);

  if (!fullPath.startsWith(sqlRoot)) {
    throw new Error("Ruta SQL no permitida");
  }

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Archivo SQL no encontrado: ${relativePath}`);
  }

  return fs.readFileSync(fullPath, "utf8");
};

module.exports = getSql;
