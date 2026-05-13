const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const mapResumen = (row, idKey) => ({
  [idKey]: Number(row.id_planilla || row.id_empleado || row.id_jubilado),
  totalIngresos: Number(row.total_ingresos || 0),
  totalDescuentos: Number(row.total_descuentos || 0),
  liquido: Number((Number(row.total_ingresos || 0) - Number(row.total_descuentos || 0)).toFixed(2)),
  cantidadIngresos: Number(row.cantidad_ingresos || 0),
  cantidadDescuentos: Number(row.cantidad_descuentos || 0)
});

const resumenPorPlanilla = async (id) => {
  logger.info("Consulta resumen nomina por planilla", { id });
  const [rows] = await pool.execute(getSql("nomina/resumen/resumenPorPlanilla.sql"), [id, id, id, id, id]);
  return mapResumen(rows[0], "idPlanilla");
};
const resumenPorEmpleado = async (id) => {
  logger.info("Consulta resumen nomina por empleado", { id });
  const [rows] = await pool.execute(getSql("nomina/resumen/resumenPorEmpleado.sql"), [id, id, id, id, id]);
  return mapResumen(rows[0], "idEmpleado");
};
const resumenPorJubilado = async (id) => {
  logger.info("Consulta resumen nomina por jubilado", { id });
  const [rows] = await pool.execute(getSql("nomina/resumen/resumenPorJubilado.sql"), [id, id, id, id, id]);
  return mapResumen(rows[0], "idJubilado");
};

module.exports = { resumenPorPlanilla, resumenPorEmpleado, resumenPorJubilado };
