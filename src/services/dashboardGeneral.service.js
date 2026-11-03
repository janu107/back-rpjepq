const { pool } = require("../config/db");

// ============================================================================
// Panel principal: indicadores generales del régimen en una sola llamada.
// Solo lectura. Montos en quetzales con 2 decimales.
// ============================================================================

const num = (v) => Math.round(Number(v || 0) * 100) / 100;
const uno = async (sql, params = []) => (await pool.query(sql, params))[0][0] || {};
const varios = async (sql, params = []) => (await pool.query(sql, params))[0];

// Neto (ingresos − descuentos) de las últimas planillas de un tipo, en orden cronológico.
const netoPlanillas = async (tipo, limite = 12) => {
  const filas = await varios(
    `SELECT p.ppl_correlativo AS id, p.ppl_numero AS numero, p.ppl_estado_proceso AS estado, p.ppl_fecha_pago AS fechaPago,
            COALESCE(i.ingresos, 0) AS ingresos, COALESCE(d.descuentos, 0) AS descuentos, COALESCE(i.personas, 0) AS personas
       FROM RPJ_CAT_PARAMETRO_PLANILLA p
       LEFT JOIN (SELECT nin_id_planilla, SUM(nin_valor) AS ingresos,
                         COUNT(DISTINCT COALESCE(nin_id_empleado, CONCAT('J', nin_id_jubilado, '-', COALESCE(nin_id_beneficiario, 0)))) AS personas
                    FROM RPJ_PRC_NOMINA_INGRESO GROUP BY nin_id_planilla) i ON i.nin_id_planilla = p.ppl_correlativo
       LEFT JOIN (SELECT nde_id_planilla, SUM(nde_valor) AS descuentos
                    FROM RPJ_PRC_NOMINA_DESCUENTO GROUP BY nde_id_planilla) d ON d.nde_id_planilla = p.ppl_correlativo
      WHERE p.ppl_tipo_planilla = ? AND p.ppl_estado_proceso IN ('GENERADA', 'CERRADA')
      ORDER BY p.ppl_numero DESC LIMIT ?`, [tipo, limite]
  );
  return filas.reverse().map((f) => ({
    numero: f.numero, estado: f.estado, fechaPago: f.fechaPago, personas: Number(f.personas),
    ingresos: num(f.ingresos), descuentos: num(f.descuentos), neto: num(f.ingresos - f.descuentos)
  }));
};

const general = async () => {
  const anio = new Date().getFullYear();

  const [personas, deuda, deudaBen, aportes, porTipo, aportesMes, jubilados, empleados, pend] = await Promise.all([
    uno(`SELECT
           (SELECT COUNT(*) FROM RPJ_MNT_EMPLEADO WHERE UPPER(COALESCE(emp_estado, 'ACTIVO')) = 'ACTIVO') AS empleados,
           (SELECT COUNT(*) FROM RPJ_MNT_APORTACION_EPQ WHERE apo_estado = 'ACTIVO') AS aportantes,
           (SELECT COUNT(*) FROM RPJ_MNT_APORTACION_EPQ) AS aportantesTotal,
           (SELECT COUNT(*) FROM RPJ_MNT_JUBILADO WHERE jub_estado = 'ACTIVO' AND jub_estado_pago = 'ACTIVO') AS jubilados,
           (SELECT COUNT(*) FROM RPJ_MNT_JUBILADO WHERE jub_estado = 'ACTIVO' AND jub_estado_pago = 'ACTIVO' AND jub_tipo_pago = 'AMPARISTA') AS amparistas,
           (SELECT COUNT(*) FROM RPJ_MNT_JUBILADO WHERE jub_estado_pago = 'FALLECIDO') AS fallecidos,
           (SELECT COUNT(*) FROM RPJ_MNT_BENEFICIARIO WHERE ben_estado = 'ACTIVO') AS beneficiarios,
           (SELECT COUNT(*) FROM RPJ_MNT_JUNTA_DIRECTIVA WHERE jun_estado = 'ACTIVO') AS junta`),
    uno(`SELECT COALESCE(SUM(deu_monto_pendiente), 0) AS total, COUNT(DISTINCT deu_id_jubilado) AS personas, COUNT(*) AS meses
           FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_estado IN ('PENDIENTE', 'PARCIAL') AND deu_monto_pendiente > 0`),
    uno(`SELECT COALESCE(SUM(dbe_monto_pendiente), 0) AS total, COUNT(DISTINCT dbe_id_beneficiario) AS personas
           FROM RPJ_PRC_DEUDA_BENEFICIARIO WHERE dbe_estado IN ('PENDIENTE', 'PARCIAL') AND dbe_monto_pendiente > 0`),
    uno(`SELECT COALESCE(SUM(CASE WHEN YEAR(dap_fecha_pago) = ? THEN dap_valor END), 0) AS actual,
                COALESCE(SUM(CASE WHEN YEAR(dap_fecha_pago) = ? THEN dap_valor END), 0) AS anterior,
                COALESCE(SUM(dap_valor), 0) AS historico
           FROM RPJ_MNT_DETALLE_APORTACION_EPQ`, [anio, anio - 1]),
    varios(`SELECT COALESCE(t.tju_descripcion, 'SIN CLASIFICAR') AS tipo, COUNT(*) AS personas
              FROM RPJ_MNT_JUBILADO j LEFT JOIN RPJ_CAT_TIPO_JUBILACION t ON t.tju_id = j.jub_tipo_jubilacion
             WHERE j.jub_estado = 'ACTIVO' AND j.jub_estado_pago = 'ACTIVO'
             GROUP BY tipo ORDER BY personas DESC`),
    varios(`SELECT MONTH(dap_fecha_pago) AS mes, SUM(dap_valor) AS total
              FROM RPJ_MNT_DETALLE_APORTACION_EPQ WHERE YEAR(dap_fecha_pago) = ? GROUP BY mes ORDER BY mes`, [anio]),
    netoPlanillas(2),
    netoPlanillas(1),
    uno(`SELECT
           (SELECT COUNT(*) FROM RPJ_MNT_JUBILADO j WHERE j.jub_estado = 'ACTIVO' AND j.jub_estado_pago = 'ACTIVO'
               AND NOT EXISTS (SELECT 1 FROM RPJ_MNT_DATOS_PLANILLA d WHERE d.dat_id_jubilado = j.jub_correlativo AND d.dat_tipo_manejo = 2)) AS jubSinDatos,
           (SELECT COUNT(*) FROM RPJ_MNT_BENEFICIARIO b WHERE b.ben_estado = 'ACTIVO' AND b.ben_tipo_parentesco IN ('HIJO', 'HIJO_INVALIDEZ')
               AND TIMESTAMPDIFF(YEAR, b.ben_fecha_nacimiento, CURDATE()) < 18
               AND NOT EXISTS (SELECT 1 FROM RPJ_MNT_TUTOR t WHERE t.tut_id_beneficiario = b.ben_correlativo AND t.tut_estado = 'VIGENTE')) AS menoresSinTutor,
           (SELECT COUNT(*) FROM RPJ_MNT_SESION WHERE ses_estado = 'ACTIVA') AS sesionesSinAprobar,
           (SELECT COUNT(*) FROM RPJ_MNT_DIETA WHERE vdi_estado = 'PENDIENTE' AND vdi_valor > 0) AS dietasPendientes`)
  ]);

  const [generadas] = await pool.query(
    `SELECT p.ppl_numero AS numero, COALESCE(t.tpl_descripcion, CONCAT('Tipo ', p.ppl_tipo_planilla)) AS tipo
       FROM RPJ_CAT_PARAMETRO_PLANILLA p LEFT JOIN RPJ_CAT_TIPO_PLANILLA t ON t.tpl_id = p.ppl_tipo_planilla
      WHERE p.ppl_estado_proceso = 'GENERADA' ORDER BY p.ppl_numero`
  );

  return {
    fecha: new Date().toISOString(),
    personas: Object.fromEntries(Object.entries(personas).map(([k, v]) => [k, Number(v)])),
    deuda: {
      jubilados: num(deuda.total), jubiladosPersonas: Number(deuda.personas), meses: Number(deuda.meses),
      beneficiarios: num(deudaBen.total), beneficiariosPersonas: Number(deudaBen.personas),
      total: num(Number(deuda.total) + Number(deudaBen.total))
    },
    aportes: {
      anio, actual: num(aportes.actual), anterior: num(aportes.anterior), historico: num(aportes.historico),
      porMes: Array.from({ length: 12 }, (_, i) => num((aportesMes.find((m) => Number(m.mes) === i + 1) || {}).total))
    },
    jubiladosPorTipo: porTipo.map((t) => ({ tipo: t.tipo, personas: Number(t.personas) })),
    planillas: { jubilados, empleados },
    pendientes: {
      planillasGeneradas: generadas.map((g) => ({ numero: g.numero, tipo: g.tipo })),
      jubiladosSinDatosPago: Number(pend.jubSinDatos),
      menoresSinTutor: Number(pend.menoresSinTutor),
      sesionesSinAprobar: Number(pend.sesionesSinAprobar),
      dietasPendientes: Number(pend.dietasPendientes)
    }
  };
};

module.exports = { general };
