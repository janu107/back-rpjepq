const { pool } = require("../config/db");

// ============================================================================
// Dashboard (6 KPIs) y reportes del módulo de jubilados.
// Solo lectura.
// ============================================================================

const toNum = (v) => Number(v || 0);

const dashboardResumen = async () => {
  const [[k]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM RPJ_MNT_JUBILADO WHERE jub_tipo_manejo=2 AND jub_estado='ACTIVO' AND jub_tipo_pago='NORMAL' AND jub_estado_pago='ACTIVO') AS normalesActivos,
      (SELECT COUNT(*) FROM RPJ_MNT_JUBILADO WHERE jub_tipo_manejo=2 AND jub_estado='ACTIVO' AND jub_tipo_pago='AMPARISTA' AND jub_estado_pago='ACTIVO') AS amparistas,
      (SELECT COUNT(DISTINCT j.jub_correlativo) FROM RPJ_MNT_JUBILADO j
         INNER JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_id_jubilado=j.jub_correlativo AND b.ben_estado='ACTIVO'
        WHERE j.jub_estado_pago='FALLECIDO') AS fallecidosConBeneficiarios,
      (SELECT COUNT(*) FROM RPJ_MNT_BENEFICIARIO WHERE ben_estado='ACTIVO') AS beneficiariosActivos,
      (SELECT COUNT(*) FROM RPJ_MNT_BENEFICIARIO WHERE ben_estado='SUSPENDIDO') AS beneficiariosSuspendidos,
      (SELECT COALESCE(SUM(deu_saldo),0) FROM RPJ_MNT_DEUDA WHERE deu_es_deuda=1 AND deu_estado IN ('PENDIENTE','PARCIAL')) AS deudaTotal
  `);
  return {
    jubiladosNormalActivos: toNum(k.normalesActivos),
    amparistas: toNum(k.amparistas),
    fallecidosConBeneficiarios: toNum(k.fallecidosConBeneficiarios),
    beneficiariosActivos: toNum(k.beneficiariosActivos),
    beneficiariosSuspendidos: toNum(k.beneficiariosSuspendidos),
    deudaTotal: toNum(k.deudaTotal)
  };
};

const saldos = async () => {
  const [rows] = await pool.query(`
    SELECT j.jub_correlativo AS idJubilado, CONCAT(j.jub_nombres,' ',j.jub_apellidos) AS nombre, j.jub_dpi AS dpi,
           j.jub_tipo_pago AS tipoPago, j.jub_estado_pago AS estadoPago,
           COALESCE(SUM(CASE WHEN d.deu_es_deuda=1 AND d.deu_estado IN ('PENDIENTE','PARCIAL') THEN d.deu_saldo ELSE 0 END),0) AS saldo
      FROM RPJ_MNT_JUBILADO j
      LEFT JOIN RPJ_MNT_DEUDA d ON d.deu_id_jubilado=j.jub_correlativo
     WHERE j.jub_tipo_manejo=2
     GROUP BY j.jub_correlativo HAVING saldo > 0 ORDER BY saldo DESC`);
  return rows.map((r) => ({ ...r, saldo: toNum(r.saldo) }));
};

const pagos = async (desde, hasta) => {
  const cond = ["i.nin_tipo_manejo=2"];
  const params = [];
  if (desde) { cond.push("p.ppl_fecha_pago >= ?"); params.push(desde); }
  if (hasta) { cond.push("p.ppl_fecha_pago <= ?"); params.push(hasta); }
  const [rows] = await pool.query(`
    SELECT i.nin_correlativo AS id, p.ppl_numero AS periodo, p.ppl_fecha_pago AS fechaPago,
           i.nin_id_tipo_planilla AS tipoPlanilla, i.nin_id_jubilado AS idJubilado, i.nin_id_beneficiario AS idBeneficiario,
           COALESCE(CONCAT(j.jub_nombres,' ',j.jub_apellidos), CONCAT(b.ben_nombres,' ',b.ben_apellidos)) AS beneficiario,
           i.nin_valor AS total
      FROM RPJ_PRC_NOMINA_INGRESO i
      LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo=i.nin_id_planilla
      LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo=i.nin_id_jubilado
      LEFT JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_correlativo=i.nin_id_beneficiario
     WHERE ${cond.join(" AND ")}
     ORDER BY p.ppl_fecha_pago DESC, i.nin_correlativo DESC LIMIT 500`, params);
  return rows.map((r) => ({ ...r, total: toNum(r.total) }));
};

const beneficiariosActivos = async () => {
  const [rows] = await pool.query(`
    SELECT b.ben_correlativo AS id, CONCAT(b.ben_nombres,' ',b.ben_apellidos) AS nombre, b.ben_dpi AS dpi,
           b.ben_tipo_parentesco AS parentesco, b.ben_porcentaje AS porcentaje,
           CONCAT(j.jub_nombres,' ',j.jub_apellidos) AS jubilado
      FROM RPJ_MNT_BENEFICIARIO b
      INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo=b.ben_id_jubilado
     WHERE b.ben_estado='ACTIVO' ORDER BY jubilado, nombre`);
  return rows.map((r) => ({ ...r, porcentaje: toNum(r.porcentaje) }));
};

const convenios = async () => {
  const [rows] = await pool.query(`
    SELECT c.con_correlativo AS id, c.con_tipo_convenio AS tipo, c.con_estado AS estado, c.con_monto_total AS deudaTotal,
           c.con_monto_cuota AS montoCuota, c.con_cantidad_cuotas AS cuotas, c.con_fecha_inicio AS fechaInicio, c.con_fecha_fin_estimada AS fechaFin,
           COALESCE(CONCAT(j.jub_nombres,' ',j.jub_apellidos), CONCAT(b.ben_nombres,' ',b.ben_apellidos)) AS titular
      FROM RPJ_MNT_CONVENIO_PAGO c
      LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo=c.con_id_jubilado
      LEFT JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_correlativo=c.con_id_beneficiario
     ORDER BY c.con_fecha_inicio DESC`);
  return rows.map((r) => ({ ...r, deudaTotal: toNum(r.deudaTotal), montoCuota: toNum(r.montoCuota), cuotas: toNum(r.cuotas) }));
};

const deudaPorTipo = async () => {
  const [rows] = await pool.query(`
    SELECT deu_tipo_pago AS tipoPago,
           SUM(CASE WHEN deu_es_deuda=1 THEN 1 ELSE 0 END) AS periodosDeuda,
           COALESCE(SUM(CASE WHEN deu_es_deuda=1 AND deu_estado IN ('PENDIENTE','PARCIAL') THEN deu_saldo ELSE 0 END),0) AS saldo
      FROM RPJ_MNT_DEUDA GROUP BY deu_tipo_pago`);
  return rows.map((r) => ({ tipoPago: r.tipoPago, periodosDeuda: toNum(r.periodosDeuda), saldo: toNum(r.saldo) }));
};

const amparistas = async () => {
  const [rows] = await pool.query(`
    SELECT ju.jub_correlativo AS idJubilado, CONCAT(ju.jub_nombres,' ',ju.jub_apellidos) AS nombre, ju.jub_dpi AS dpi,
           ju.jub_estado_pago AS estadoPago, j.jui_no_expediente AS noExpediente, j.jui_juzgado AS juzgado,
           j.jui_fecha_efectiva AS fechaEfectiva, j.jui_estado AS estadoJuicio
      FROM RPJ_MNT_JUBILADO ju
      LEFT JOIN RPJ_MNT_JUICIO j ON j.jui_id_jubilado=ju.jub_correlativo AND j.jui_estado='VIGENTE'
     WHERE ju.jub_tipo_pago='AMPARISTA' ORDER BY nombre`);
  return rows;
};

module.exports = { dashboardResumen, saldos, pagos, beneficiariosActivos, convenios, deudaPorTipo, amparistas };
