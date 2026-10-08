const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

// Catálogos para agregar renglones manuales en "Editar montos" de las nóminas.
const listarTiposMonto = async () => {
  const [[ingresos], [descuentos]] = await Promise.all([
    pool.execute(getSql("planillas-montos/tiposIngreso.sql")),
    pool.execute(getSql("planillas-montos/tiposDescuento.sql"))
  ]);
  return { ingresos, descuentos };
};

// Valida los renglones nuevos: [{ clase: "INGRESO"|"DESCUENTO", tipo, valor }].
const validarNuevos = (nuevos, crearError) => {
  const lista = Array.isArray(nuevos) ? nuevos : [];
  return lista.map((n) => {
    const clase = String(n?.clase || "").toUpperCase();
    const tipo = Number(n?.tipo);
    const valor = Number(n?.valor);
    if (!["INGRESO", "DESCUENTO"].includes(clase)) throw crearError("Renglón nuevo inválido: indique si es ingreso o descuento");
    if (!Number.isInteger(tipo) || tipo <= 0) throw crearError("Seleccione el tipo de cada renglón nuevo");
    if (Number.isNaN(valor) || valor <= 0) throw crearError("El monto de cada renglón nuevo debe ser mayor a 0");
    return { clase, tipo, valor: Math.round(valor * 100) / 100 };
  });
};

module.exports = { listarTiposMonto, validarNuevos };
