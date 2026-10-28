const { pool } = require("../config/db");

// Dashboard de aportaciones de empleados EPQ: totales por año, indicadores,
// empleados que más han aportado y aportes por gerencia (todos los años o uno).

const num = (v) => Math.round(Number(v || 0) * 100) / 100;

const dashboard = async (anioParam) => {
  const anio = /^\d{4}$/.test(String(anioParam || "")) ? Number(anioParam) : null;
  const filtroAnio = anio ? "AND YEAR(d.dap_fecha_pago) = ?" : "";
  const pAnio = anio ? [anio] : [];

  const [porAnio] = await pool.query(`
    SELECT YEAR(d.dap_fecha_pago) AS anio, COUNT(*) AS aportes, SUM(d.dap_valor) AS total,
           COUNT(DISTINCT d.dap_id_aportacion) AS empleados
      FROM RPJ_MNT_DETALLE_APORTACION_EPQ d
     WHERE d.dap_fecha_pago IS NOT NULL
     GROUP BY YEAR(d.dap_fecha_pago)
     ORDER BY anio`);

  const [[gen]] = await pool.query(`
    SELECT COUNT(*) AS aportes, SUM(d.dap_valor) AS total, COUNT(DISTINCT d.dap_id_aportacion) AS empleados,
           MIN(d.dap_fecha_pago) AS desde, MAX(d.dap_fecha_pago) AS hasta
      FROM RPJ_MNT_DETALLE_APORTACION_EPQ d`);

  const [[activos]] = await pool.query(
    "SELECT COUNT(*) AS n FROM RPJ_MNT_APORTACION_EPQ WHERE UPPER(COALESCE(apo_estado, '')) = 'ACTIVO'"
  );

  // Indicadores del año elegido (o del último año con datos).
  const anioKpi = anio || (porAnio.length ? porAnio[porAnio.length - 1].anio : null);
  const [[kAnio]] = await pool.query(`
    SELECT COUNT(*) AS aportes, SUM(d.dap_valor) AS total, COUNT(DISTINCT d.dap_id_aportacion) AS empleados,
           COUNT(DISTINCT DATE_FORMAT(d.dap_fecha_pago, '%Y-%m')) AS meses
      FROM RPJ_MNT_DETALLE_APORTACION_EPQ d
     WHERE YEAR(d.dap_fecha_pago) = ?`, [anioKpi || 0]);

  const [top] = await pool.query(`
    SELECT a.apo_correlativo AS id, a.apo_id AS codigo, CONCAT(a.apo_nombre, ' ', a.apo_apellido) AS nombre,
           a.apo_gerencia AS gerencia, a.apo_estado AS estado,
           COUNT(*) AS aportes, SUM(d.dap_valor) AS total, MIN(d.dap_fecha_pago) AS desde, MAX(d.dap_fecha_pago) AS hasta
      FROM RPJ_MNT_DETALLE_APORTACION_EPQ d
      JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = d.dap_id_aportacion
     WHERE 1 = 1 ${filtroAnio}
     GROUP BY a.apo_correlativo, a.apo_id, nombre, a.apo_gerencia, a.apo_estado
     ORDER BY total DESC
     LIMIT 15`, pAnio);

  const [porGerencia] = await pool.query(`
    SELECT COALESCE(NULLIF(TRIM(a.apo_gerencia), ''), 'SIN GERENCIA') AS gerencia,
           COUNT(DISTINCT a.apo_correlativo) AS empleados, COUNT(*) AS aportes, SUM(d.dap_valor) AS total
      FROM RPJ_MNT_DETALLE_APORTACION_EPQ d
      JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = d.dap_id_aportacion
     WHERE 1 = 1 ${filtroAnio}
     GROUP BY gerencia
     ORDER BY total DESC`, pAnio);

  const totalFiltro = porGerencia.reduce((s, g) => s + Number(g.total || 0), 0);
  const totalKpi = num(kAnio.total);
  const empleadosKpi = Number(kAnio.empleados || 0);
  const mesesKpi = Number(kAnio.meses || 0);

  return {
    anio,
    anioKpi,
    general: {
      total: num(gen.total), aportes: Number(gen.aportes || 0), empleados: Number(gen.empleados || 0),
      desde: gen.desde, hasta: gen.hasta, activos: Number(activos.n || 0)
    },
    kpiAnio: {
      total: totalKpi, aportes: Number(kAnio.aportes || 0), empleados: empleadosKpi, meses: mesesKpi,
      promedioMensualEmpleado: empleadosKpi && mesesKpi ? num(totalKpi / empleadosKpi / mesesKpi) : 0
    },
    porAnio: porAnio.map((r) => ({ anio: r.anio, aportes: Number(r.aportes), total: num(r.total), empleados: Number(r.empleados) })),
    top: top.map((r) => ({
      id: r.id, codigo: r.codigo, nombre: r.nombre, gerencia: r.gerencia, estado: r.estado,
      aportes: Number(r.aportes), total: num(r.total), desde: r.desde, hasta: r.hasta,
      porcentaje: totalFiltro ? Math.round((Number(r.total) / totalFiltro) * 1000) / 10 : 0
    })),
    porGerencia: porGerencia.map((g) => ({
      gerencia: g.gerencia, empleados: Number(g.empleados), aportes: Number(g.aportes), total: num(g.total),
      porcentaje: totalFiltro ? Math.round((Number(g.total) / totalFiltro) * 1000) / 10 : 0
    })),
    totalFiltro: num(totalFiltro)
  };
};

module.exports = { dashboard };
