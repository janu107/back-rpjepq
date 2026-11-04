const PDFDocument = require("pdfkit");
const logger = require("../config/logger");
const { pool } = require("../config/db");
const { createError } = require("../utils/planillaEstado");

// ============================================================================
// Consultas del módulo de Jubilados (deuda, resumen, historia) + registro de
// fallecimiento. Se monta en /jubilados ANTES del router de mantenimiento, y
// solo define rutas específicas (no GET /:id), por lo que el CRUD existente de
// jubilados sigue funcionando por fall-through.
// ============================================================================

const toNum = (v) => Number(v || 0);

// CALL de SP con variables de sesión @out en una sola conexión.
const callSp = async (spCall, inParams, outNames) => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CALL ${spCall}`, inParams);
    if (!outNames || !outNames.length) return {};
    const outSelect = outNames.map((n) => `@${n} AS ${n}`).join(", ");
    const [[outRow]] = await conn.query(`SELECT ${outSelect}`);
    return outRow;
  } finally {
    conn.release();
  }
};

const mapJubBusqueda = (r) => ({
  id: r.id, idJubilado: r.idJubilado, dpi: r.dpi, nombreCompleto: r.nombreCompleto,
  estado: r.estado, tipoPago: r.tipoPago, estadoPago: r.estadoPago
});

const SELECT_JUB = `SELECT jub_correlativo AS id, jub_id AS idJubilado, jub_dpi AS dpi,
  CONCAT(jub_nombres, ' ', jub_apellidos) AS nombreCompleto,
  jub_estado AS estado, jub_tipo_pago AS tipoPago, jub_estado_pago AS estadoPago
  FROM RPJ_MNT_JUBILADO`;

// Un término puramente numérico se admite desde 1 carácter: es una búsqueda por
// código (jub_id). Para texto se mantiene el mínimo de 3 para no traer media tabla.
const minimoTermino = (term) => (/^\d+$/.test(term) ? 1 : 3);

const buscar = async (q, estado) => {
  const term = String(q || "").trim();
  if (term.length < minimoTermino(term)) return [];
  const like = `%${term}%`;
  const cond = ["(jub_id LIKE ? OR jub_nombres LIKE ? OR jub_apellidos LIKE ? OR jub_dpi LIKE ? OR CONCAT(jub_nombres,' ',jub_apellidos) LIKE ?)"];
  const params = [like, like, like, like, like];
  if (estado) { cond.push("jub_estado = ?"); params.push(String(estado).toUpperCase()); }
  const [rows] = await pool.query(`${SELECT_JUB} WHERE ${cond.join(" AND ")} ORDER BY jub_nombres, jub_apellidos LIMIT 20`, params);
  return rows.map(mapJubBusqueda);
};

const noAmparistas = async (q) => {
  const term = String(q || "").trim();
  const like = `%${term}%`;
  const filtro = term ? " AND (jub_id LIKE ? OR jub_nombres LIKE ? OR jub_apellidos LIKE ? OR jub_dpi LIKE ?)" : "";
  const params = term ? [like, like, like, like] : [];
  const [rows] = await pool.query(
    `${SELECT_JUB} WHERE jub_estado = 'ACTIVO' AND jub_tipo_pago = 'NORMAL'
       AND jub_correlativo NOT IN (SELECT jui_id_jubilado FROM RPJ_MNT_JUICIO WHERE jui_estado = 'VIGENTE')
       ${filtro}
     ORDER BY jub_nombres, jub_apellidos LIMIT 20`,
    params
  );
  return rows.map(mapJubBusqueda);
};

// Mes (AAAAMM) en que falleció, si está registrado como fallecido. Lo cobrado con
// su código DESPUÉS de ese mes lo cobró su cónyuge (por ejemplo, si el fallecimiento
// se registró años después): se muestra en el estado de cuenta del cónyuge.
const mesFallecimiento = async (id) => {
  const [[r]] = await pool.execute(
    "SELECT jub_estado_pago AS estadoPago, jub_fecha_fallecimiento AS fecha FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?", [id]
  );
  if (!r || r.estadoPago !== "FALLECIDO" || !r.fecha) return null;
  const f = new Date(r.fecha);
  return f.getUTCFullYear() * 100 + f.getUTCMonth() + 1;
};
const SIN_CORTE = 999999;

// Aguinaldo y bono 14 del fallecido: van en su deuda con período especial
// AAAA13 (AGUINALDO del año AAAA) y AAAA14 (BONO 14 del año AAAA).
const esPrestacion = (periodo) => Number(periodo) % 100 > 12;
const nombrePrestacion = (periodo) => {
  const m = Number(periodo) % 100;
  const y = Math.floor(Number(periodo) / 100);
  return m === 13 ? `AGUINALDO ${y}` : m === 14 ? `BONO 14 ${y}` : null;
};
// Los renglones de la deuda del fallecido van hasta su mes de muerte, más sus prestaciones.
const delFallecido = (corte) => (r) => Number(r.periodo) <= corte || esPrestacion(r.periodo);

const assertJubilado = async (id) => {
  const [rows] = await pool.execute("SELECT jub_correlativo FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?", [id]);
  if (!rows[0]) throw createError("Jubilado no encontrado", 404);
};

const deudaTotal = async (id) => {
  await assertJubilado(id);
  const [rows] = await pool.execute(
    // Deuda vigente (regla del líquido). La tabla RPJ_MNT_DEUDA ya no se usa.
    `SELECT COALESCE(SUM(deu_monto_pendiente), 0) AS deudaTotal, COUNT(*) AS periodos
       FROM RPJ_PRC_DEUDA_JUBILADO
      WHERE deu_id_jubilado = ? AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0`,
    [id]
  );
  return { idJubilado: Number(id), deudaTotal: toNum(rows[0].deudaTotal), periodosPendientes: toNum(rows[0].periodos) };
};

const mapBen = (b) => ({
  id: b.id, tipoParentesco: b.tipoParentesco, nombres: b.nombres, apellidos: b.apellidos,
  dpi: b.dpi, fechaNacimiento: b.fechaNacimiento, porcentaje: toNum(b.porcentaje), estado: b.estado,
  monto: b.monto === null || b.monto === undefined ? null : toNum(b.monto),
  tieneTutora: Number(b.tutores) > 0
});
const SELECT_BEN = `SELECT ben_correlativo AS id, ben_tipo_parentesco AS tipoParentesco, ben_nombres AS nombres,
  ben_apellidos AS apellidos, ben_dpi AS dpi, ben_fecha_nacimiento AS fechaNacimiento,
  ben_porcentaje AS porcentaje, ben_monto AS monto, ben_estado AS estado,
  (SELECT COUNT(*) FROM RPJ_MNT_TUTOR t WHERE t.tut_id_beneficiario = ben_correlativo) AS tutores
  FROM RPJ_MNT_BENEFICIARIO`;

const beneficiariosPorEstado = async (id, estado) => {
  await assertJubilado(id);
  const [rows] = await pool.execute(`${SELECT_BEN} WHERE ben_id_jubilado = ? AND ben_estado = ? ORDER BY ben_correlativo`, [id, estado]);
  return rows.map(mapBen);
};
const beneficiariosRegistrados = (id) => beneficiariosPorEstado(id, "REGISTRADO");
const beneficiariosActivos = (id) => beneficiariosPorEstado(id, "ACTIVO");

const resumenFinanciero = async (id) => {
  await assertJubilado(id);
  const [[jub]] = await pool.execute(`${SELECT_JUB} WHERE jub_correlativo = ?`, [id]);
  const [[pen]] = await pool.execute(
    `SELECT COALESCE(sal_salario, 0) AS pension FROM RPJ_MNT_SALARIO
      WHERE sal_id_jubilado = ? AND sal_tipo_manejo = 2 AND sal_tipo_ingreso = 1
      ORDER BY sal_correlativo LIMIT 1`, [id]
  );
  // Si falleció, lo suyo llega hasta el mes del fallecimiento; lo posterior lo cobró su cónyuge.
  const corte = (await mesFallecimiento(id)) || SIN_CORTE;
  // Deuda: RPJ_PRC_DEUDA_JUBILADO es la tabla que llenan la carga histórica y la
  // nómina mensual (la que de verdad cobra). RPJ_MNT_DEUDA no la llena ningún
  // proceso; por eso antes todo salía en cero.
  const [[deu]] = await pool.execute(
    `SELECT COALESCE(SUM(CASE WHEN deu_estado IN ('PENDIENTE','PARCIAL') THEN deu_monto_pendiente ELSE 0 END),0) AS deudaPendiente,
            COALESCE(SUM(CASE WHEN deu_estado IN ('PENDIENTE','PARCIAL') THEN 1 ELSE 0 END),0) AS periodosDeuda,
            COALESCE(SUM(deu_monto_original),0) AS deudaGenerada
       FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ? AND deu_id_beneficiario IS NULL AND (deu_periodo <= ? OR MOD(deu_periodo, 100) > 12)`, [id, corte]
  );
  // Pagos: lo que realmente recibió (ingreso − descuentos) en las planillas de
  // jubilados (incluidas las históricas) y cuántos meses ha tenido pago.
  const [[pag]] = await pool.execute(
    `SELECT COALESCE(SUM(i.nin_valor),0)
            - COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d
                          INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA p2 ON p2.ppl_correlativo = d.nde_id_planilla
                         WHERE d.nde_id_jubilado = ? AND d.nde_id_beneficiario IS NULL AND d.nde_tipo_manejo = 2
                           AND p2.ppl_tipo_planilla IN (2, 4) AND p2.ppl_estado_proceso <> 'REVERSADA' AND p2.ppl_numero <= ?), 0) AS totalPagado,
            COUNT(DISTINCT p.ppl_numero) AS periodosHistoria
       FROM RPJ_PRC_NOMINA_INGRESO i
       INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
      WHERE i.nin_id_jubilado = ? AND i.nin_id_beneficiario IS NULL AND i.nin_tipo_manejo = 2
        AND p.ppl_tipo_planilla IN (2, 4) AND p.ppl_estado_proceso <> 'REVERSADA' AND p.ppl_numero <= ?`, [id, corte, id, corte]
  );
  let fallecimiento = null;
  if (jub.estadoPago === "FALLECIDO") {
    const [[fx]] = await pool.execute(
      "SELECT jub_fecha_fallecimiento AS fecha, jub_no_defuncion AS certificado FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?", [id]
    );
    // Lo cobrado con su código después de fallecer (lo cobró su cónyuge).
    const [[desp]] = await pool.execute(
      `SELECT COUNT(DISTINCT p.ppl_numero) AS meses, MIN(p.ppl_numero) AS desde, MAX(p.ppl_numero) AS hasta
         FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
        WHERE i.nin_id_jubilado = ? AND i.nin_id_beneficiario IS NULL AND p.ppl_tipo_planilla IN (2, 4)
          AND p.ppl_estado_proceso <> 'REVERSADA' AND p.ppl_numero > ?`, [id, corte]
    );
    fallecimiento = {
      fecha: fx?.fecha || null, certificado: fx?.certificado || null, cancelacion: await cancelacionVigente(id), mes: corte,
      cobradoPorConyuge: toNum(desp?.meses) > 0 ? { meses: toNum(desp.meses), desde: desp.desde, hasta: desp.hasta } : null
    };
  }
  return {
    ...mapJubBusqueda(jub),
    fallecimiento,
    pension: toNum(pen ? pen.pension : 0),
    deudaPendiente: toNum(deu.deudaPendiente),
    periodosDeuda: toNum(deu.periodosDeuda),
    periodosHistoria: toNum(pag.periodosHistoria),
    totalPagado: toNum(pag.totalPagado),
    deudaGenerada: toNum(deu.deudaGenerada)
  };
};

const ultimosPagos = async (id, limit) => {
  await assertJubilado(id);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 60);
  const corte = (await mesFallecimiento(id)) || SIN_CORTE;
  const [rows] = await pool.query(
    `SELECT i.nin_correlativo AS id, i.nin_id_planilla AS idPlanilla, p.ppl_numero AS periodo,
            p.ppl_fecha_pago AS fechaPago, i.nin_valor AS bruto, i.nin_pago_corriente AS pagoCorriente,
            i.nin_abono_historico AS abono, i.nin_id_tipo_planilla AS tipoPlanilla,
            COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d
                       WHERE d.nde_id_planilla = i.nin_id_planilla AND d.nde_id_jubilado = i.nin_id_jubilado), 0) AS descuentos
       FROM RPJ_PRC_NOMINA_INGRESO i
       LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
      WHERE i.nin_id_jubilado = ? AND i.nin_tipo_manejo = 2 AND i.nin_id_beneficiario IS NULL
        AND (p.ppl_estado_proceso IS NULL OR p.ppl_estado_proceso <> 'REVERSADA')
        AND (p.ppl_numero IS NULL OR p.ppl_numero <= ?)
      ORDER BY p.ppl_numero DESC, i.nin_correlativo DESC LIMIT ?`,
    [id, corte, lim]
  );
  return rows.map((r) => ({
    id: r.id, idPlanilla: r.idPlanilla, periodo: r.periodo, fechaPago: r.fechaPago,
    // total = lo que recibió (ingreso − descuentos); pagoCorriente + abono = total.
    total: toNum(r.bruto) - toNum(r.descuentos), bruto: toNum(r.bruto), descuentos: toNum(r.descuentos),
    pagoCorriente: toNum(r.pagoCorriente), abono: toNum(r.abono), tipoPlanilla: r.tipoPlanilla
  }));
};

const mapDeuda = (d) => ({
  id: d.id, periodo: d.periodo, esDeuda: Boolean(d.esDeuda), tipoPago: d.tipoPago,
  pensionCompleta: toNum(d.pensionCompleta), montoGenerado: toNum(d.montoGenerado), montoPagado: toNum(d.montoPagado),
  saldo: toNum(d.saldo), estado: d.estado, fechaGeneracion: d.fechaGeneracion
});
const SELECT_DEUDA = `SELECT deu_correlativo AS id, deu_periodo AS periodo, deu_es_deuda AS esDeuda,
  deu_tipo_pago AS tipoPago, deu_pension_completa AS pensionCompleta, deu_monto_generado AS montoGenerado,
  deu_monto_pagado AS montoPagado, deu_saldo AS saldo, deu_estado AS estado, deu_fecha_generacion AS fechaGeneracion
  FROM RPJ_MNT_DEUDA`;

const deudaDetalle = async (id) => {
  await assertJubilado(id);
  // Meses con deuda (tabla real de deuda; ver resumenFinanciero).
  const historia = await historiaCompleta(id);
  return historia.filter((h) => h.esDeuda);
};

// Historia mes a mes del jubilado. Une lo pagado en cada planilla (incluidas las
// históricas) con la deuda de ese mes. Regla del líquido (2026-10): cada mes con
// deuda vale su líquido y lo que se paga en una nómina se abona al mes más antiguo.
//   pensionCompleta = pensión del mes
//   montoGenerado   = líquido del mes (con deuda) o lo pagado (meses completos)
//   montoPagado     = lo abonado a ese mes (con deuda) o lo pagado (meses completos)
//   recibidoMes     = lo que recibió en la planilla de ese mes (va a la deuda más antigua)
//   saldo           = lo que aún se debe de ese mes
//   tipoPago        = COMPLETO o el porcentaje pagado (ej. 50%)
// Historia del jubilado hasta su fallecimiento (si falleció).
const historiaCompleta = async (id) => {
  const corte = (await mesFallecimiento(id)) || SIN_CORTE;
  return (await historiaSinCorte(id)).filter(delFallecido(corte));
};
// Lo cobrado con su código después de fallecer: es la historia de su cónyuge.
const historiaDespuesDeFallecer = async (id) => {
  const corte = await mesFallecimiento(id);
  if (!corte) return [];
  return (await historiaSinCorte(id)).filter((r) => Number(r.periodo) > corte && !esPrestacion(r.periodo));
};

const historiaSinCorte = async (id) => {
  await assertJubilado(id);
  const [rows] = await pool.execute(
    `SELECT x.periodo,
            MAX(x.pension) AS pensionCompleta, MAX(x.porcentaje) AS porcentaje,
            SUM(x.pagado_mes) AS pagadoMes, MAX(x.fecha_pago) AS fechaPago,
            MAX(x.deuda_id) AS id, MAX(x.deuda_original) AS deudaOriginal,
            MAX(x.deuda_pagada) AS deudaPagada, MAX(x.deuda_pendiente) AS deudaPendiente,
            MAX(x.deuda_estado) AS deudaEstado, MAX(x.deuda_planilla) AS deudaPlanilla,
            SUM(x.descuentos) AS descuentos, MAX(x.detalle_desc) AS detalleDescuentos,
            MAX(x.en_proceso) AS enProceso, MAX(x.pagado_con) AS pagadoCon, MAX(x.cancelada_doc) AS canceladaDoc, MAX(x.cancelada_tipo) AS canceladaTipo, MAX(x.deu_obs) AS deuObs
       FROM (
         SELECT p.ppl_numero AS periodo, i.nin_valor_teorico AS pension, i.nin_porcentaje_aplicado AS porcentaje,
                i.nin_valor - COALESCE((SELECT SUM(dd.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO dd
                                         WHERE dd.nde_id_planilla = i.nin_id_planilla AND dd.nde_id_jubilado = i.nin_id_jubilado), 0) AS pagado_mes,
                p.ppl_fecha_pago AS fecha_pago,
                NULL AS deuda_id, NULL AS deuda_original, NULL AS deuda_pagada, NULL AS deuda_pendiente, NULL AS deuda_estado, NULL AS deuda_planilla,
                COALESCE((SELECT SUM(dd.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO dd
                           WHERE dd.nde_id_planilla = i.nin_id_planilla AND dd.nde_id_jubilado = i.nin_id_jubilado), 0) AS descuentos,
                (SELECT GROUP_CONCAT(CONCAT(COALESCE(td.tde_descripcion, 'DESCUENTO'), ': ', FORMAT(dd.nde_valor, 2)) SEPARATOR ' | ')
                   FROM RPJ_PRC_NOMINA_DESCUENTO dd LEFT JOIN RPJ_CAT_TIPO_DESCUENTO td ON td.tde_id = dd.nde_tipo_descuento
                  WHERE dd.nde_id_planilla = i.nin_id_planilla AND dd.nde_id_jubilado = i.nin_id_jubilado) AS detalle_desc,
                IF(p.ppl_estado_proceso = 'GENERADA', 1, 0) AS en_proceso,
                NULL AS pagado_con, NULL AS cancelada_doc, NULL AS cancelada_tipo, NULL AS deu_obs
           FROM RPJ_PRC_NOMINA_INGRESO i
           INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
          WHERE i.nin_id_jubilado = ? AND i.nin_id_beneficiario IS NULL AND i.nin_tipo_manejo = 2
            AND p.ppl_tipo_planilla IN (2, 4) AND p.ppl_estado_proceso <> 'REVERSADA'
         UNION ALL
         SELECT d.deu_periodo, NULL, NULL, 0, NULL,
                d.deu_correlativo, d.deu_monto_original, d.deu_monto_pagado, d.deu_monto_pendiente, d.deu_estado, d.deu_id_planilla,
                0, NULL, 0,
                -- Planillas (nóminas cerradas) que abonaron a la deuda de este mes.
                (SELECT GROUP_CONCAT(DISTINCT pa.ppl_numero ORDER BY pa.ppl_numero SEPARATOR ',')
                   FROM RPJ_PRC_APLICACION_PAGO a JOIN RPJ_CAT_PARAMETRO_PLANILLA pa ON pa.ppl_correlativo = a.apa_id_planilla
                  WHERE a.apa_id_deuda = d.deu_correlativo) AS pagado_con,
                (SELECT MAX(c.cde_documento) FROM RPJ_PRC_CANCELACION_DEUDA_DET cd
                   JOIN RPJ_PRC_CANCELACION_DEUDA c ON c.cde_correlativo = cd.cdd_id_cancelacion AND c.cde_estado = 'VIGENTE'
                  WHERE cd.cdd_id_deuda = d.deu_correlativo) AS cancelada_doc,
                (SELECT MAX(c.cde_tipo) FROM RPJ_PRC_CANCELACION_DEUDA_DET cd
                   JOIN RPJ_PRC_CANCELACION_DEUDA c ON c.cde_correlativo = cd.cdd_id_cancelacion AND c.cde_estado = 'VIGENTE'
                  WHERE cd.cdd_id_deuda = d.deu_correlativo) AS cancelada_tipo,
                d.deu_observaciones AS deu_obs
           FROM RPJ_PRC_DEUDA_JUBILADO d
          WHERE d.deu_id_jubilado = ? AND d.deu_id_beneficiario IS NULL
       ) x
      GROUP BY x.periodo
      ORDER BY x.periodo`,
    [id, id]
  );
  const desglose = await desglosePorPeriodo(id);
  return rows.map((r) => {
    const fila = historiaMes(r);
    // Descuentos por grupo (mismos grupos de la nómina impresa). Si el mes no tiene
    // el detalle guardado, la diferencia va a "otros" para que el desglose cuadre.
    const grupos = { ...GRUPOS_VACIOS, ...(desglose[r.periodo] || {}) };
    const sumaGrupos = Object.values(grupos).reduce((a, b) => a + b, 0);
    const resto = Math.round((fila.descuentos - sumaGrupos) * 100) / 100;
    if (resto > 0) grupos.otros = Math.round((grupos.otros + resto) * 100) / 100;
    // Mes del fallecimiento pagado proporcional: se indica cuántos días.
    const prop = String(r.deuObs || "").match(/Proporcional por fallecimiento \((\d+)\/30/);
    if (prop) { fila.tipoPago = `${fila.tipoPago} · ${prop[1]} días`; fila.proporcional = true; }
    // Tipo de ingreso: pensión del mes, o aguinaldo / bono 14 del fallecido.
    fila.ingreso = nombrePrestacion(r.periodo) ? (Number(r.periodo) % 100 === 13 ? "AGUINALDO" : "BONO 14") : "PENSIÓN";
    if (fila.ingreso !== "PENSIÓN") {
      const d = String(r.deuObs || "").match(/\((\d+)\/365 días/);
      fila.prestacion = nombrePrestacion(r.periodo);
      fila.tipoPago = `${/completo/i.test(r.deuObs || "") ? "COMPLETO" : "PROPORCIONAL"}${d ? ` · ${d[1]} días` : ""}`;
      fila.pensionCompleta = 0;
      fila.descuentos = 0;
    }
    // Meses de la deuda que se pagaron fuera del sistema (cancelación registrada).
    if (r.canceladaDoc) return { ...fila, desglose: grupos, estado: "CANCELADA", canceladaFuera: r.canceladaDoc, canceladaMes: r.canceladaTipo === "MES" };
    return { ...fila, desglose: grupos };
  });
};

// Grupos de descuento (iguales a las columnas de la nómina de jubilados).
const GRUPOS_VACIOS = { asociacion: 0, prestamos: 0, judicial: 0, banrural: 0, bantrab: 0, otros: 0 };
const grupoDescuento = (tipo) => {
  switch (Number(tipo)) {
    case 8: return "asociacion";
    case 7: case 9: case 11: return "prestamos";
    case 4: return "judicial";
    case 5: return "banrural";
    case 6: return "bantrab";
    default: return "otros";
  }
};

const desglosePorPeriodo = async (id) => {
  const [rows] = await pool.execute(
    `SELECT p.ppl_numero AS periodo, dd.nde_tipo_descuento AS tipo, SUM(dd.nde_valor) AS valor
       FROM RPJ_PRC_NOMINA_DESCUENTO dd
       INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = dd.nde_id_planilla
      WHERE dd.nde_id_jubilado = ? AND p.ppl_tipo_planilla IN (2, 4) AND p.ppl_estado_proceso <> 'REVERSADA'
        AND EXISTS (SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO i
                     WHERE i.nin_id_planilla = dd.nde_id_planilla AND i.nin_id_jubilado = dd.nde_id_jubilado
                       AND i.nin_id_beneficiario IS NULL AND i.nin_tipo_manejo = 2)
      GROUP BY p.ppl_numero, dd.nde_tipo_descuento`,
    [id]
  );
  const out = {};
  rows.forEach((r) => {
    const g = grupoDescuento(r.tipo);
    out[r.periodo] = out[r.periodo] || {};
    out[r.periodo][g] = Math.round(((out[r.periodo][g] || 0) + toNum(r.valor)) * 100) / 100;
  });
  return out;
};

// Arma la fila de un mes de la historia (ver historiaCompleta).
const historiaMes = (r) => {
    const deuda = toNum(r.deudaOriginal);
    const pct = r.porcentaje === null ? null : toNum(r.porcentaje);
    const descuentos = toNum(r.descuentos);
    // Planilla generada y aún sin cerrar: el mes todavía no entra a la deuda.
    // Se muestra como quedará al cerrar: vale su líquido, sin abono y con saldo completo.
    if (deuda <= 0 && Number(r.enProceso) === 1) {
      const liquido = Math.round(Math.max(toNum(r.pensionCompleta) - descuentos, 0) * 100) / 100;
      return {
        id: `P${r.periodo}`, periodo: r.periodo, esDeuda: true, enProceso: true,
        tipoPago: pct === null ? "SIN PAGO" : `${pct}%`,
        pensionCompleta: toNum(r.pensionCompleta), descuentos, detalleDescuentos: r.detalleDescuentos || "",
        montoGenerado: liquido, montoPagado: 0, recibidoMes: toNum(r.pagadoMes), saldo: liquido,
        estado: "EN PROCESO", fechaGeneracion: r.fechaPago
      };
    }
    return {
      descuentos: deuda > 0 && descuentos === 0 ? Math.round(Math.max(toNum(r.pensionCompleta) - deuda, 0) * 100) / 100 : descuentos,
      detalleDescuentos: r.detalleDescuentos || "",
      id: r.id || `P${r.periodo}`,
      periodo: r.periodo,
      esDeuda: deuda > 0,
      // Un mes con deuda que ya se terminó de pagar se muestra COMPLETADO.
      tipoPago: deuda > 0 && toNum(r.deudaPendiente) <= 0 ? "COMPLETADO"
        : pct === null ? "SIN PAGO" : pct >= 100 ? "COMPLETO" : `${pct}%`,
      pensionCompleta: toNum(r.pensionCompleta),
      montoGenerado: deuda > 0 ? deuda : toNum(r.pagadoMes),
      // Abonado = lo pagado a la DEUDA de ese mes por las nóminas cerradas.
      montoPagado: deuda > 0 ? toNum(r.deudaPagada) : 0,
      // Meses pagados completos (antes del 50%) no tienen deuda: sin abono.
      sinDeuda: !(deuda > 0),
      pagadoCon: r.pagadoCon ? String(r.pagadoCon).split(",") : [],
      recibidoMes: toNum(r.pagadoMes),
      saldo: toNum(r.deudaPendiente),
      // Estado visible según lo abonado a la DEUDA (no el pago normal del 50%).
      estado: !r.deudaEstado ? "PAGADO"
        : toNum(r.deudaPendiente) <= 0 ? "PAGADA"
        : (toNum(r.deudaPagada) > 0 ? "PARCIAL" : "PENDIENTE"),
      fechaGeneracion: r.fechaPago
    };
};

// ---------------------------------------------------------------------------
// Ajuste de la deuda por fallecimiento. El mes del fallecimiento se paga
// proporcional a los días vividos (mes de 30 días: pensión y descuentos × días/30)
// y los meses posteriores que solo eran deuda (sin planilla pagada con su código,
// sin abonos) se borran. Se guarda lo cambiado para poder restaurarlo.
// ---------------------------------------------------------------------------
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

const revertirAjusteFallecimiento = async (conn, idJubilado) => {
  const [[aj]] = await conn.query(
    "SELECT afa_correlativo AS id, afa_detalle AS detalle FROM RPJ_PRC_AJUSTE_FALLECIMIENTO WHERE afa_id_jubilado = ? AND afa_estado = 'VIGENTE' ORDER BY afa_correlativo DESC LIMIT 1 FOR UPDATE",
    [idJubilado]
  );
  if (!aj) return false;
  const d = JSON.parse(aj.detalle);
  if (d.prorrateo) {
    const p = d.prorrateo;
    await conn.execute(
      "UPDATE RPJ_PRC_NOMINA_INGRESO SET nin_valor = ?, nin_valor_teorico = ?, nin_pago_corriente = ?, nin_dias_trabajados = ? WHERE nin_correlativo = ?",
      [p.ingreso.valor, p.ingreso.teorico, p.ingreso.pagoCorriente, p.ingreso.dias, p.ingreso.id]
    );
    for (const x of p.descuentos) await conn.execute("UPDATE RPJ_PRC_NOMINA_DESCUENTO SET nde_valor = ? WHERE nde_correlativo = ?", [x.valor, x.id]);
    await conn.execute(
      `UPDATE RPJ_PRC_DEUDA_JUBILADO SET deu_monto_original = ?, deu_monto_pendiente = GREATEST(? - deu_monto_pagado, 0), deu_observaciones = ?
        WHERE deu_correlativo = ?`, [p.deuda.original, p.deuda.original, p.deuda.obs, p.deuda.id]
    );
    await conn.execute(
      `UPDATE RPJ_PRC_DEUDA_JUBILADO SET deu_estado = CASE WHEN deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
        WHERE deu_correlativo = ?`, [p.deuda.id]
    );
  }
  for (const fila of d.borrados || []) {
    const cols = Object.keys(fila);
    await conn.query(`INSERT INTO RPJ_PRC_DEUDA_JUBILADO (${cols.join(", ")}) VALUES (?)`, [cols.map((c) => fila[c])]);
  }
  await conn.execute("UPDATE RPJ_PRC_AJUSTE_FALLECIMIENTO SET afa_estado = 'REVERTIDO', afa_fecha_reversion = NOW() WHERE afa_correlativo = ?", [aj.id]);
  return true;
};

const aplicarAjusteFallecimiento = async (conn, idJubilado, fecha, usuario) => {
  const [y, mo, dia] = String(fecha).slice(0, 10).split("-").map(Number);
  const mes = y * 100 + mo;
  const dias = Math.min(dia, 30);
  const detalle = { mes, dias, prorrateo: null, borrados: [], avisos: [] };

  // 1) Mes del fallecimiento proporcional (si no vivió el mes completo).
  if (dias < 30) {
    let m = null;
    try { m = await mesHistoria(idJubilado, mes, conn); } catch { m = null; }
    if (m && m.editable) {
      const [[ing]] = await conn.query(
        "SELECT nin_correlativo AS id, nin_valor AS valor, nin_valor_teorico AS teorico, nin_pago_corriente AS pagoCorriente, nin_dias_trabajados AS dias FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_correlativo = ?",
        [m.ingreso.id]
      );
      const [[deu]] = await conn.query("SELECT deu_monto_original AS original, deu_observaciones AS obs FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_correlativo = ?", [m.deuda.id]);
      detalle.prorrateo = {
        ingreso: { id: ing.id, valor: r2(ing.valor), teorico: r2(ing.teorico), pagoCorriente: r2(ing.pagoCorriente), dias: ing.dias },
        descuentos: m.descuentos.map((x) => ({ id: x.id, valor: r2(x.valor) })),
        deuda: { id: m.deuda.id, original: r2(deu.original), obs: deu.obs }
      };
      const f = dias / 30;
      const pension = r2(m.pension * f);
      let totalDesc = 0;
      for (const x of m.descuentos) {
        const v = r2(x.valor * f);
        totalDesc += v;
        await conn.execute("UPDATE RPJ_PRC_NOMINA_DESCUENTO SET nde_valor = ? WHERE nde_correlativo = ?", [v, x.id]);
      }
      totalDesc = r2(totalDesc);
      const liquido = Math.max(r2(pension - totalDesc), 0);
      const recibido = r2((liquido * m.porcentaje) / 100);
      await conn.execute(
        "UPDATE RPJ_PRC_NOMINA_INGRESO SET nin_valor = ?, nin_valor_teorico = ?, nin_pago_corriente = ?, nin_dias_trabajados = ? WHERE nin_correlativo = ?",
        [r2(recibido + totalDesc), pension, recibido, dias, ing.id]
      );
      await conn.execute(
        `UPDATE RPJ_PRC_DEUDA_JUBILADO
            SET deu_monto_original = ?, deu_monto_pendiente = GREATEST(? - deu_monto_pagado, 0),
                deu_observaciones = LEFT(CONCAT(COALESCE(CONCAT(deu_observaciones, ' | '), ''), ?), 250)
          WHERE deu_correlativo = ?`, [liquido, liquido, `Proporcional por fallecimiento (${dias}/30 días)`, m.deuda.id]
      );
      await conn.execute(
        `UPDATE RPJ_PRC_DEUDA_JUBILADO SET deu_estado = CASE WHEN deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
          WHERE deu_correlativo = ?`, [m.deuda.id]
      );
      detalle.prorrateo.resultado = { pension, descuentos: totalDesc, liquido, recibido };
    } else if (m) {
      detalle.avisos.push(`El mes ${mes} no se ajustó proporcional: ${m.motivo}`);
    }
  }

  // 2) Meses posteriores que solo eran deuda: se borran.
  const [despues] = await conn.query(
    `SELECT d.* FROM RPJ_PRC_DEUDA_JUBILADO d
      WHERE d.deu_id_jubilado = ? AND d.deu_id_beneficiario IS NULL AND d.deu_periodo > ? AND MOD(d.deu_periodo, 100) <= 12 AND d.deu_monto_pagado = 0
        AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_APLICACION_PAGO a WHERE a.apa_id_deuda = d.deu_correlativo)
        AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
                         WHERE i.nin_id_jubilado = d.deu_id_jubilado AND i.nin_id_beneficiario IS NULL AND p.ppl_numero = d.deu_periodo
                           AND p.ppl_tipo_planilla IN (2, 4) AND p.ppl_estado_proceso = 'CERRADA')`, [idJubilado, mes]
  );
  if (despues.length) {
    detalle.borrados = despues.map((fila) => {
      const o = {};
      Object.entries(fila).forEach(([k, v]) => { o[k] = v instanceof Date ? v.toISOString().slice(0, 19).replace("T", " ") : v; });
      return o;
    });
    await conn.query("DELETE FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_correlativo IN (?)", [despues.map((x) => x.deu_correlativo)]);
  }

  if (detalle.prorrateo || detalle.borrados.length) {
    await conn.execute(
      "INSERT INTO RPJ_PRC_AJUSTE_FALLECIMIENTO (afa_id_jubilado, afa_fecha_fallecimiento, afa_detalle, afa_usuario_creacion) VALUES (?, ?, ?, ?)",
      [idJubilado, String(fecha).slice(0, 10), JSON.stringify(detalle), usuario]
    );
  }
  return {
    mes, dias, proporcional: detalle.prorrateo ? detalle.prorrateo.resultado : null,
    mesesBorrados: detalle.borrados.map((b) => b.deu_periodo), avisos: detalle.avisos
  };
};

// ---------------------------------------------------------------------------
// Aguinaldo y bono 14 del fallecido (al 100%, se suman a la deuda que cobra el
// cónyuge). Por cada prestación, solo el período en curso al fallecer:
// proporcional, días vividos / 365 (contando el día del fallecimiento). Los
// períodos ya terminados se pagaron en su momento (dentro o fuera del sistema).
// Solo períodos que terminan desde PRESTACIONES_DESDE.
// Período de aguinaldo: 1-dic al 30-nov; bono 14: 1-jul al 30-jun.
// ---------------------------------------------------------------------------
const PRESTACIONES_DESDE = "2026-06-30";
const OBS_PRESTACION = "Prestación por fallecimiento";
const TIPOS_PRESTACION = [
  { nombre: "AGUINALDO", codigo: 13, tipoPlanilla: 8, mesInicio: 12 },
  { nombre: "BONO 14", codigo: 14, tipoPlanilla: 6, mesInicio: 7 }
];
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10));
const diasIncl = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
const pad2 = (n) => String(n).padStart(2, "0");
const periodoDePrestacion = (t, anio) => {
  const finMes = t.mesInicio - 1; // aguinaldo termina en noviembre, bono 14 en junio
  const ultimo = new Date(Date.UTC(anio, finMes, 0)).getUTCDate();
  return { ini: `${anio - 1}-${pad2(t.mesInicio)}-01`, fin: `${anio}-${pad2(finMes)}-${ultimo}` };
};

const calcularPrestacionesFallecimiento = async (conn, idJubilado, fecha) => {
  const f = iso(fecha);
  const [[j]] = await conn.query(
    `SELECT jub_fecha_jubilacion AS jubilacion, COALESCE(jub_fallecido_en_servicio, 0) AS enServicio,
            (SELECT sal_salario FROM RPJ_MNT_SALARIO WHERE sal_id_jubilado = jub_correlativo AND sal_tipo_manejo = 2
                AND sal_tipo_ingreso = 1 AND sal_salario > 0 ORDER BY sal_correlativo LIMIT 1) AS pension
       FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?`, [idJubilado]
  );
  if (!j || Number(j.enServicio) === 1 || !(toNum(j.pension) > 0)) return [];
  const pension = toNum(j.pension);
  const jubilacion = j.jubilacion ? iso(j.jubilacion) : null;
  const [y, m] = f.split("-").map(Number);
  const filas = [];
  for (const t of TIPOS_PRESTACION) {
    const anioActual = m >= t.mesInicio ? y + 1 : y;
    for (const anio of [anioActual]) {
      const per = periodoDePrestacion(t, anio);
      if (per.fin < PRESTACIONES_DESDE) continue;
      const completo = per.fin < f;
      const desde = jubilacion && jubilacion > per.ini ? jubilacion : per.ini;
      const hasta = completo ? per.fin : f;
      const dias = Math.min(365, Math.max(0, diasIncl(desde, hasta)));
      if (dias <= 0) continue;
      // ¿Ya se le pagó en una planilla de esa prestación de ese año?
      const [[ya]] = await conn.query(
        `SELECT COUNT(*) AS n FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
          WHERE i.nin_id_jubilado = ? AND i.nin_id_beneficiario IS NULL AND p.ppl_tipo_planilla = ?
            AND p.ppl_estado_proceso <> 'REVERSADA' AND (FLOOR(p.ppl_numero / 100) = ? OR p.ppl_numero = ?)`,
        [idJubilado, t.tipoPlanilla, anio, t.codigo === 13 ? (anio + 1) * 100 + 1 : -1]
      );
      if (toNum(ya.n) > 0) continue;
      filas.push({
        periodo: anio * 100 + t.codigo, prestacion: `${t.nombre} ${anio}`, completo, desde, hasta, dias,
        pension, monto: r2((pension * dias) / 365)
      });
    }
  }
  return filas;
};

const aplicarPrestacionesFallecimiento = async (conn, idJubilado, fecha, usuario) => {
  const filas = await calcularPrestacionesFallecimiento(conn, idJubilado, fecha);
  const out = { agregadas: [], avisos: [] };
  for (const x of filas) {
    const [[existe]] = await conn.query(
      "SELECT deu_correlativo AS id FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ? AND deu_periodo = ?", [idJubilado, x.periodo]
    );
    if (existe) { out.avisos.push(`${x.prestacion} ya estaba en la deuda; no se cambió.`); continue; }
    const obs = `${OBS_PRESTACION}: ${x.prestacion} ${x.completo ? "completo" : "proporcional"} (${x.dias}/365 días, ${x.desde} al ${x.hasta})`;
    await conn.execute(
      `INSERT INTO RPJ_PRC_DEUDA_JUBILADO (deu_id_jubilado, deu_periodo, deu_monto_original, deu_monto_pagado, deu_monto_pendiente,
         deu_estado, deu_es_deuda, deu_tipo_pago, deu_fecha_generacion, deu_observaciones, deu_usuario_creacion)
       VALUES (?, ?, ?, 0, ?, 'PENDIENTE', 1, 'NORMAL', CURDATE(), ?, ?)`,
      [idJubilado, x.periodo, x.monto, x.monto, obs.slice(0, 250), usuario]
    );
    out.agregadas.push({ prestacion: x.prestacion, dias: x.dias, completo: x.completo, monto: x.monto });
  }
  return out;
};

// Quita el aguinaldo / bono 14 agregados al fallecer. No se puede si ya se cobró algo.
const revertirPrestacionesFallecimiento = async (conn, idJubilado) => {
  const [filas] = await conn.query(
    `SELECT d.deu_correlativo AS id, d.deu_periodo AS periodo, d.deu_monto_pagado AS pagado,
            (SELECT COUNT(*) FROM RPJ_PRC_APLICACION_PAGO a WHERE a.apa_id_deuda = d.deu_correlativo) AS abonos
       FROM RPJ_PRC_DEUDA_JUBILADO d
      WHERE d.deu_id_jubilado = ? AND MOD(d.deu_periodo, 100) IN (13, 14) AND d.deu_observaciones LIKE ? FOR UPDATE`,
    [idJubilado, `${OBS_PRESTACION}%`]
  );
  const cobradas = filas.filter((x) => toNum(x.pagado) > 0 || toNum(x.abonos) > 0);
  if (cobradas.length) {
    throw createError(`Ya se cobró parte de ${cobradas.map((x) => nombrePrestacion(x.periodo)).join(", ")}: no se puede quitar de la deuda`, 409);
  }
  if (filas.length) await conn.query("DELETE FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_correlativo IN (?)", [filas.map((x) => x.id)]);
  return filas.length;
};

const conTransaccion = async (fn) => {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const r = await fn(conn); await conn.commit(); return r; } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
};

// ---------------------------------------------------------------------------
// Forma de cobro de la deuda del fallecido (la decide el cónyuge):
//   PORCENTAJE: como se le pagaba a él, el % de la planilla sobre su último líquido.
//   CONVENIO:   una cuota mensual fija acordada (RPJ_MNT_CONVENIO_PAGO VIGENTE del
//               cónyuge). La planilla le paga esa cuota completa hasta saldar.
// Se puede cambiar cuando se quiera; aplica desde la planilla que se genere (y
// se recalculan las planillas de jubilados GENERADAS).
// ---------------------------------------------------------------------------
const AUTORIZA_CONVENIO = ["JUEZ", "JUNTA_DIRECTIVA", "ACUERDO_INTERNO"];

const convenioVigente = async (idBeneficiario, executor = pool) => {
  const [[c]] = await executor.query(
    `SELECT con_correlativo AS id, con_monto_cuota AS cuota, con_monto_total AS montoTotal, con_cantidad_cuotas AS cuotas,
            con_fecha_inicio AS fechaInicio, con_fecha_fin_estimada AS fechaFin, con_autorizado_por AS autorizadoPor,
            con_no_documento AS documento, con_observaciones AS observaciones, con_usuario_creacion AS usuario, con_fecha_creacion AS registrado
       FROM RPJ_MNT_CONVENIO_PAGO WHERE con_id_beneficiario = ? AND con_estado = 'VIGENTE'
      ORDER BY con_correlativo DESC LIMIT 1`, [idBeneficiario]
  );
  return c ? { ...c, cuota: toNum(c.cuota), montoTotal: toNum(c.montoTotal), cuotas: toNum(c.cuotas) } : null;
};

const datosCobroConyuge = async (id, executor = pool) => {
  const [[jub]] = await executor.query(
    "SELECT jub_estado_pago AS estadoPago, COALESCE(jub_fallecido_en_servicio, 0) AS enServicio FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?", [id]
  );
  if (!jub) throw createError("Jubilado no encontrado", 404);
  if (jub.estadoPago !== "FALLECIDO") throw createError("El jubilado no está registrado como fallecido", 409);
  const [[con]] = await executor.query(
    `SELECT ben_correlativo AS id, TRIM(CONCAT(COALESCE(ben_nombres, ''), ' ', COALESCE(ben_apellidos, ''))) AS nombre, ben_tipo_parentesco AS parentesco
       FROM RPJ_MNT_BENEFICIARIO WHERE ben_id_jubilado = ? AND ben_tipo_parentesco IN ('ESPOSA', 'ESPOSO') AND ben_estado = 'ACTIVO'
      ORDER BY ben_correlativo LIMIT 1`, [id]
  );
  const [[d]] = await executor.query(
    `SELECT COALESCE(SUM(CASE WHEN deu_estado IN ('PENDIENTE','PARCIAL') THEN deu_monto_pendiente END), 0) AS pendiente,
            (SELECT deu_monto_original FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ?
              ORDER BY (MOD(deu_periodo, 100) > 12), (COALESCE(deu_observaciones, '') LIKE '%Proporcional por fallecimiento%'), deu_periodo DESC LIMIT 1) AS ultimoLiquido
       FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ?`, [id, id]
  );
  const [[pla]] = await executor.query(
    "SELECT ppl_porcentaje_pago AS pct FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = 2 AND ppl_estado_proceso <> 'REVERSADA' ORDER BY ppl_numero DESC LIMIT 1"
  );
  const pct = toNum(pla?.pct || 50);
  return {
    enServicio: Number(jub.enServicio) === 1, conyuge: con || null, pendiente: toNum(d.pendiente),
    porcentaje: pct, ultimoLiquido: toNum(d.ultimoLiquido), cuotaPorcentaje: r2((toNum(d.ultimoLiquido) * pct) / 100)
  };
};

const formaCobro = async (id) => {
  const x = await datosCobroConyuge(id);
  const convenio = x.conyuge ? await convenioVigente(x.conyuge.id) : null;
  return { ...x, modo: convenio ? "CONVENIO" : "PORCENTAJE", convenio };
};

const guardarFormaCobro = async (id, body, currentUser) => {
  const modo = String(body?.modo || "").toUpperCase();
  if (!["PORCENTAJE", "CONVENIO"].includes(modo)) throw createError("Indique la forma de cobro: PORCENTAJE o CONVENIO");
  const usuario = currentUser?.usuario || "sistema";
  return conTransaccion(async (conn) => {
    const x = await datosCobroConyuge(id, conn);
    if (!x.conyuge) throw createError("El fallecido no tiene cónyuge (esposa o esposo) activo", 409);
    const antes = await convenioVigente(x.conyuge.id, conn);
    let nuevo = null;
    if (modo === "CONVENIO") {
      const cuota = r2(body?.cuota);
      if (!(cuota > 0)) throw createError("La cuota mensual del convenio debe ser mayor a cero");
      if (!(x.pendiente > 0)) throw createError("La deuda del fallecido ya está pagada", 409);
      const autorizado = String(body?.autorizadoPor || "").toUpperCase();
      if (!AUTORIZA_CONVENIO.includes(autorizado)) throw createError("Indique quién autoriza el convenio (juez, junta directiva o acuerdo interno)");
      const documento = String(body?.documento || "").trim();
      if (!documento) throw createError("Indique el número de documento del convenio");
      const fechaInicio = String(body?.fechaInicio || new Date().toISOString().slice(0, 10)).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) throw createError("La fecha de inicio no es válida");
      const cuotas = Math.ceil(x.pendiente / cuota);
      const [fy, fm, fd] = fechaInicio.split("-").map(Number);
      const fin = new Date(Date.UTC(fy, fm - 1 + cuotas, fd)).toISOString().slice(0, 10);
      if (antes) {
        await conn.execute(
          `UPDATE RPJ_MNT_CONVENIO_PAGO SET con_estado = 'CANCELADO',
                  con_observaciones = LEFT(CONCAT(COALESCE(CONCAT(con_observaciones, ' | '), ''), ?), 500) WHERE con_correlativo = ?`,
          [`Reemplazado por un convenio nuevo el ${new Date().toISOString().slice(0, 10)} (${usuario})`, antes.id]
        );
      }
      const [res] = await conn.execute(
        `INSERT INTO RPJ_MNT_CONVENIO_PAGO (con_id_jubilado, con_id_beneficiario, con_tipo_convenio, con_monto_total, con_cantidad_cuotas,
           con_monto_cuota, con_fecha_inicio, con_fecha_fin_estimada, con_autorizado_por, con_no_documento, con_estado, con_observaciones, con_usuario_creacion)
         VALUES (?, ?, 'MENSUAL', ?, ?, ?, ?, ?, ?, ?, 'VIGENTE', ?, ?)`,
        [id, x.conyuge.id, x.pendiente, cuotas, cuota, fechaInicio, fin, autorizado, documento.slice(0, 100),
         `Cobro de la deuda del fallecido por convenio. ${String(body?.observaciones || "").trim()}`.trim().slice(0, 500), usuario]
      );
      nuevo = { id: res.insertId, cuota, cuotas, fechaInicio, fechaFin: fin };
    } else if (antes) {
      await conn.execute(
        `UPDATE RPJ_MNT_CONVENIO_PAGO SET con_estado = 'CANCELADO',
                con_observaciones = LEFT(CONCAT(COALESCE(CONCAT(con_observaciones, ' | '), ''), ?), 500) WHERE con_correlativo = ?`,
        [`Vuelve a cobro por porcentaje el ${new Date().toISOString().slice(0, 10)} (${usuario}). ${String(body?.observaciones || "").trim()}`.trim(), antes.id]
      );
    }
    const recalculadas = await recalcularBeneficiariosGenerados(conn, usuario);
    logger.info("Forma de cobro de la deuda del fallecido", { idJubilado: id, modo, convenio: nuevo, anterior: antes?.id || null, usuario });
    return { modo, convenio: nuevo, planillasRecalculadas: recalculadas };
  });
};

const registrarFallecimiento = async (id, body, currentUser) => {
  await assertJubilado(id);
  if (!body?.fechaFallecimiento) throw createError("La fecha de fallecimiento es obligatoria");
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Registrando fallecimiento jubilado", { idJubilado: id, usuario });
  const out = await callSp(
    "sp_registrar_fallecimiento_jubilado(?, ?, ?, ?, @p_ben, @p_res)",
    [id, body.fechaFallecimiento, body.noDefuncion || null, usuario],
    ["p_ben", "p_res"]
  );
  // Deuda: mes del fallecimiento proporcional y meses posteriores borrados.
  let ajuste = null;
  try {
    ajuste = await conTransaccion((conn) => aplicarAjusteFallecimiento(conn, id, body.fechaFallecimiento, usuario));
  } catch (e) {
    logger.error("No se pudo ajustar la deuda por fallecimiento", { idJubilado: id, message: e.message });
    ajuste = { avisos: ["No se pudo ajustar la deuda del mes del fallecimiento; revise el estado de cuenta."] };
  }
  // Aguinaldo y bono 14 del fallecido, a su deuda.
  try {
    const pr = await conTransaccion((conn) => aplicarPrestacionesFallecimiento(conn, id, body.fechaFallecimiento, usuario));
    ajuste = { ...ajuste, prestaciones: pr.agregadas, avisos: [...(ajuste?.avisos || []), ...pr.avisos] };
  } catch (e) {
    logger.error("No se pudo calcular aguinaldo / bono 14 del fallecido", { idJubilado: id, message: e.message });
    ajuste = { ...ajuste, avisos: [...(ajuste?.avisos || []), "No se pudo calcular el aguinaldo / bono 14 del fallecido; revise el estado de cuenta."] };
  }
  return { beneficiariosActivados: toNum(out.p_ben), message: out.p_res, ajuste };
};

// ---------------------------------------------------------------------------
// Fallecimientos registrados: corregir fecha/certificado o revertir.
// Solo mientras ninguna planilla CERRADA haya pagado a sus beneficiarios (lo
// cerrado ya es definitivo). Si hay una planilla GENERADA con ellos, se avisa
// que hay que reversarla y generarla de nuevo para recalcular.
// ---------------------------------------------------------------------------
const listarFallecidos = async () => {
  const [rows] = await pool.query(
    `SELECT j.jub_correlativo AS id, j.jub_id AS codigo, CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS nombre,
            j.jub_fecha_fallecimiento AS fechaFallecimiento, j.jub_no_defuncion AS noDefuncion,
            COALESCE(j.jub_fallecido_en_servicio, 0) AS enServicio,
            (SELECT COUNT(*) FROM RPJ_MNT_BENEFICIARIO b WHERE b.ben_id_jubilado = j.jub_correlativo) AS beneficiarios,
            (SELECT GROUP_CONCAT(DISTINCT p.ppl_numero ORDER BY p.ppl_numero SEPARATOR ', ')
               FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
              WHERE i.nin_id_jubilado = j.jub_correlativo AND i.nin_id_beneficiario IS NOT NULL
                AND p.ppl_estado_proceso = 'CERRADA') AS planillasCerradas,
            (SELECT GROUP_CONCAT(DISTINCT p.ppl_numero ORDER BY p.ppl_numero SEPARATOR ', ')
               FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
              WHERE i.nin_id_jubilado = j.jub_correlativo AND i.nin_id_beneficiario IS NOT NULL
                AND p.ppl_estado_proceso = 'GENERADA') AS planillasGeneradas,
            (SELECT COALESCE(SUM(d.deu_monto_pendiente), 0) FROM RPJ_PRC_DEUDA_JUBILADO d
              WHERE d.deu_id_jubilado = j.jub_correlativo AND d.deu_estado IN ('PENDIENTE','PARCIAL')) AS deudaPendiente,
            (SELECT COUNT(*) FROM RPJ_PRC_DEUDA_JUBILADO d
              WHERE d.deu_id_jubilado = j.jub_correlativo AND d.deu_estado IN ('PENDIENTE','PARCIAL') AND d.deu_monto_pendiente > 0) AS mesesPendientes,
            (SELECT c.con_monto_cuota FROM RPJ_MNT_CONVENIO_PAGO c JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_correlativo = c.con_id_beneficiario
              WHERE b.ben_id_jubilado = j.jub_correlativo AND c.con_estado = 'VIGENTE' ORDER BY c.con_correlativo DESC LIMIT 1) AS cuotaConvenio
       FROM RPJ_MNT_JUBILADO j
      WHERE j.jub_estado_pago = 'FALLECIDO'
      ORDER BY j.jub_fecha_fallecimiento DESC, nombre`
  );
  const [cans] = await pool.query(
    `SELECT cde_correlativo AS id, cde_id_jubilado AS idJubilado, cde_fecha AS fecha, cde_documento AS documento,
            cde_monto AS monto, cde_meses AS meses, cde_observaciones AS observaciones
       FROM RPJ_PRC_CANCELACION_DEUDA WHERE cde_estado = 'VIGENTE' AND cde_tipo = 'TOTAL'`
  );
  return rows.map((r) => {
    const c = cans.find((x) => Number(x.idJubilado) === Number(r.id));
    return {
      ...r, beneficiarios: toNum(r.beneficiarios), editable: !r.planillasCerradas, enServicio: Number(r.enServicio) === 1,
      deudaPendiente: toNum(r.deudaPendiente), mesesPendientes: toNum(r.mesesPendientes),
      cuotaConvenio: r.cuotaConvenio === null ? null : toNum(r.cuotaConvenio),
      cancelacion: c ? { ...c, monto: toNum(c.monto), meses: toNum(c.meses) } : null
    };
  });
};

const estadoFallecido = async (id) => {
  const lista = await listarFallecidos();
  const f = lista.find((x) => Number(x.id) === Number(id));
  if (!f) throw createError("El jubilado no está registrado como fallecido", 404);
  if (!f.editable) {
    throw createError(`Ya se pagó a sus beneficiarios en la planilla ${f.planillasCerradas} (CERRADA): el fallecimiento ya no se puede cambiar`, 409);
  }
  return f;
};

const avisoGeneradas = (f) => (f.planillasGeneradas
  ? `La planilla ${f.planillasGeneradas} ya está GENERADA con sus beneficiarios: reviértala y genérela de nuevo para recalcular.`
  : null);

const corregirFallecimiento = async (id, body, currentUser) => {
  const f = await estadoFallecido(id);
  const fecha = String(body?.fechaFallecimiento || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw createError("La fecha de fallecimiento es obligatoria");
  if (fecha > new Date().toISOString().slice(0, 10)) throw createError("La fecha de fallecimiento no puede ser futura");
  const noDef = String(body?.noDefuncion || "").trim();
  if (!noDef) throw createError("El No. de certificado de defunción es obligatorio");
  const usuario = currentUser?.usuario || "sistema";
  // Con la fecha nueva se restaura el ajuste anterior de la deuda y se vuelve a calcular.
  const ajuste = await conTransaccion(async (conn) => {
    await conn.execute(
      "UPDATE RPJ_MNT_JUBILADO SET jub_fecha_fallecimiento = ?, jub_no_defuncion = ? WHERE jub_correlativo = ? AND jub_estado_pago = 'FALLECIDO'",
      [fecha, noDef.slice(0, 50), id]
    );
    await conn.execute(
      "UPDATE RPJ_MNT_BENEFICIARIO SET ben_fecha_activacion = ? WHERE ben_id_jubilado = ? AND ben_estado = 'ACTIVO'",
      [fecha, id]
    );
    await revertirPrestacionesFallecimiento(conn, id);
    await revertirAjusteFallecimiento(conn, id);
    if (f.enServicio) return null;
    const aj = await aplicarAjusteFallecimiento(conn, id, fecha, usuario);
    const pr = await aplicarPrestacionesFallecimiento(conn, id, fecha, usuario);
    return { ...aj, prestaciones: pr.agregadas, avisos: [...(aj.avisos || []), ...pr.avisos] };
  });
  logger.info("Fecha de fallecimiento corregida", { idJubilado: id, fecha, usuario });
  return { id: Number(id), fechaFallecimiento: fecha, aviso: avisoGeneradas(f), ajuste };
};

const revertirFallecimiento = async (id, body, currentUser) => {
  const f = await estadoFallecido(id);
  if (f.cancelacion) throw createError("Primero revierta la cancelación de su deuda (registrada fuera del sistema)", 409);
  if (f.enServicio) throw createError("Falleció en servicio (nunca fue jubilado): no se revierte; corrija la fecha o el certificado con Corregir", 409);
  if (f.planillasGeneradas) {
    throw createError(`Primero reverse la planilla ${f.planillasGeneradas}: ya está GENERADA con sus beneficiarios`, 409);
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE RPJ_MNT_JUBILADO SET jub_estado_pago = 'ACTIVO', jub_fecha_fallecimiento = NULL, jub_no_defuncion = NULL
        WHERE jub_correlativo = ? AND jub_estado_pago = 'FALLECIDO'`, [id]
    );
    await conn.execute(
      `UPDATE RPJ_MNT_BENEFICIARIO SET ben_estado = 'REGISTRADO', ben_fecha_activacion = NULL
        WHERE ben_id_jubilado = ? AND ben_estado IN ('ACTIVO', 'INACTIVO')`, [id]
    );
    // La deuda vuelve a como estaba antes del fallecimiento.
    await revertirPrestacionesFallecimiento(conn, id);
    await revertirAjusteFallecimiento(conn, id);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  logger.info("Fallecimiento revertido", { idJubilado: id, motivo: body?.motivo, usuario: currentUser?.usuario });
  return { id: Number(id), estadoPago: "ACTIVO" };
};

// ---------------------------------------------------------------------------
// Empleado EPQ que fallece EN SERVICIO (estaba aportando, nunca fue jubilado).
// Se registra como jubilado FALLECIDO con jub_fallecido_en_servicio = 1 para poder
// asignarle beneficiarios. La pensión de referencia es la base del tope 50% / 50%.
// No tiene deuda: su cónyuge entra directo a VIUDEZ y los hijos a ORFANDAD, desde
// la planilla del mes en que se registra. El empleado EPQ queda FALLECIDO.
// ---------------------------------------------------------------------------
const registrarFallecidoEnServicio = async (body, currentUser) => {
  const idAportacion = Number(body?.idAportacion);
  const codigo = Number(body?.codigo);
  const fecha = String(body?.fechaFallecimiento || "").slice(0, 10);
  const noDef = String(body?.noDefuncion || "").trim();
  const pension = Math.round(toNum(body?.pensionReferencia) * 100) / 100;
  const tipo = Number(body?.tipoJubilacion || 3);
  if (!idAportacion) throw createError("Seleccione el empleado EPQ que falleció");
  if (!Number.isInteger(codigo) || codigo <= 0) throw createError("Indique el código con el que quedará registrado");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw createError("La fecha de fallecimiento es obligatoria");
  if (fecha > new Date().toISOString().slice(0, 10)) throw createError("La fecha de fallecimiento no puede ser futura");
  if (!noDef) throw createError("El No. de certificado de defunción es obligatorio");
  if (!(pension > 0)) throw createError("Indique la pensión de referencia (base para los montos de los beneficiarios)");
  const usuario = currentUser?.usuario || "sistema";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[apo]] = await conn.query(
      `SELECT apo_correlativo AS id, apo_id AS codigo, apo_nombre AS nombre, apo_apellido AS apellido, apo_dpi AS dpi,
              apo_fecha_nacimiento AS fechaNacimiento, apo_sexo AS sexo, apo_ubicacion AS ubicacion, apo_estado AS estado
         FROM RPJ_MNT_APORTACION_EPQ WHERE apo_correlativo = ? FOR UPDATE`, [idAportacion]
    );
    if (!apo) throw createError("Empleado EPQ no encontrado", 404);
    if (String(apo.estado).toUpperCase() === "FALLECIDO") throw createError("Este empleado EPQ ya está registrado como fallecido", 409);
    const [dupCod] = await conn.query("SELECT jub_correlativo FROM RPJ_MNT_JUBILADO WHERE jub_id = ? LIMIT 1", [codigo]);
    if (dupCod.length) throw createError(`Ya existe un jubilado con el código ${codigo}: use otro código`, 409);
    const [dupDpi] = await conn.query("SELECT jub_id FROM RPJ_MNT_JUBILADO WHERE jub_dpi = ? LIMIT 1", [apo.dpi]);
    if (dupDpi.length) throw createError(`El DPI ${apo.dpi} ya está registrado como jubilado (código ${dupDpi[0].jub_id})`, 409);
    const [tj] = await conn.query("SELECT tju_id FROM RPJ_CAT_TIPO_JUBILACION WHERE tju_id = ?", [tipo]);
    if (!tj.length) throw createError("Tipo de jubilación no válido");
    // Cobran desde la planilla siguiente a la última de jubilados ya CERRADA (sin atrasados).
    const [[ult]] = await conn.query(
      "SELECT MAX(ppl_numero) AS n FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = 2 AND ppl_estado_proceso = 'CERRADA'"
    );
    const hoy = new Date();
    const mesActual = hoy.getFullYear() * 100 + hoy.getMonth() + 1;
    const sig = ult?.n ? (Number(ult.n) % 100 === 12 ? Number(ult.n) + 89 : Number(ult.n) + 1) : mesActual;
    const inicio = Math.max(sig, Number(fecha.slice(0, 4)) * 100 + Number(fecha.slice(5, 7)));

    const [res] = await conn.execute(
      `INSERT INTO RPJ_MNT_JUBILADO
         (jub_tipo_manejo, jub_id, jub_nombres, jub_apellidos, jub_fecha_nacimiento, jub_dpi, jub_direccion, jub_profesion_oficio,
          jub_estado_civil, jub_estado, jub_fecha_jubilacion, jub_tipo_jubilacion, jub_usuario_creacion, jub_sexo, jub_tipo_pago,
          jub_estado_pago, jub_fecha_fallecimiento, jub_no_defuncion, jub_fallecido_en_servicio, jub_periodo_inicio_beneficios)
       VALUES (2, ?, ?, ?, ?, ?, ?, 'EMPLEADO EPQ (FALLECIÓ EN SERVICIO)', 'N/A', 'ACTIVO', ?, ?, ?, ?, 'NORMAL', 'FALLECIDO', ?, ?, 1, ?)`,
      [codigo, apo.nombre, apo.apellido, apo.fechaNacimiento, apo.dpi, apo.ubicacion || "N/A", fecha, tipo, usuario,
       apo.sexo || null, fecha, noDef.slice(0, 50), inicio]
    );
    await conn.execute(
      "INSERT INTO RPJ_MNT_SALARIO (sal_tipo_manejo, sal_id_jubilado, sal_tipo_ingreso, sal_salario, sal_usuario_creacion) VALUES (2, ?, 1, ?, ?)",
      [res.insertId, pension, usuario]
    );
    await conn.execute(
      `UPDATE RPJ_MNT_APORTACION_EPQ
          SET apo_estado = 'FALLECIDO', apo_fecha_fin_aportacion = ?, apo_motivo_retiro = 'FALLECIMIENTO EN SERVICIO'
        WHERE apo_correlativo = ?`, [fecha, idAportacion]
    );
    await conn.commit();
    logger.info("Fallecido en servicio registrado", { idAportacion, codigo, idJubilado: res.insertId, usuario });
    return { idJubilado: res.insertId, codigo, nombre: `${apo.nombre} ${apo.apellido}`, inicioBeneficios: inicio };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------------
// Deuda del fallecido pagada FUERA del sistema (p. ej. se le pagó a la viuda antes
// de usar este sistema). Sus meses pendientes quedan PAGADOS, se guarda el detalle
// para poder revertir, y la esposa pasa de "cobro de deuda" a VIUDEZ. Si hay una
// planilla de jubilados GENERADA, sus renglones de beneficiarios se recalculan.
// ---------------------------------------------------------------------------
const cancelacionVigente = async (idJubilado, executor = pool) => {
  const [[c]] = await executor.query(
    `SELECT cde_correlativo AS id, cde_fecha AS fecha, cde_documento AS documento, cde_monto AS monto, cde_meses AS meses,
            cde_observaciones AS observaciones, cde_fecha_creacion AS registrada, cde_usuario_creacion AS usuario
       FROM RPJ_PRC_CANCELACION_DEUDA WHERE cde_id_jubilado = ? AND cde_estado = 'VIGENTE' AND cde_tipo = 'TOTAL'
      ORDER BY cde_correlativo DESC LIMIT 1`, [idJubilado]
  );
  return c ? { ...c, monto: toNum(c.monto), meses: toNum(c.meses) } : null;
};

// Recalcula los beneficiarios de las planillas de jubilados GENERADAS (sin cerrar).
const recalcularBeneficiariosGenerados = async (conn, usuario) => {
  const [pls] = await conn.query(
    "SELECT ppl_correlativo AS id, ppl_numero AS numero FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = 2 AND ppl_estado_proceso = 'GENERADA'"
  );
  for (const p of pls) await conn.query("CALL sp_generar_beneficiarios_planilla(?, ?, @bp, @bt)", [p.id, usuario]);
  return pls.map((p) => p.numero);
};

const cancelarDeudaFallecido = async (id, body, currentUser) => {
  const [[jub]] = await pool.execute(
    "SELECT jub_estado_pago AS estadoPago, CONCAT(jub_nombres, ' ', jub_apellidos) AS nombre FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?", [id]
  );
  if (!jub) throw createError("Jubilado no encontrado", 404);
  if (jub.estadoPago !== "FALLECIDO") throw createError("Solo se cancela la deuda de un jubilado registrado como fallecido", 409);
  const fecha = String(body?.fecha || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw createError("Indique la fecha en que se pagó");
  if (fecha > new Date().toISOString().slice(0, 10)) throw createError("La fecha no puede ser futura");
  const documento = String(body?.documento || "").trim();
  if (!documento) throw createError("Indique el documento que respalda el pago (resolución, acta, cheque, etc.)");
  const usuario = currentUser?.usuario || "sistema";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (await cancelacionVigente(id, conn)) throw createError("La deuda de este jubilado ya está registrada como cancelada", 409);
    const [meses] = await conn.query(
      `SELECT deu_correlativo AS id, deu_periodo AS periodo, deu_monto_pendiente AS pendiente
         FROM RPJ_PRC_DEUDA_JUBILADO
        WHERE deu_id_jubilado = ? AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0
        ORDER BY deu_periodo FOR UPDATE`, [id]
    );
    if (!meses.length) throw createError("El jubilado no tiene deuda pendiente", 409);
    const total = Math.round(meses.reduce((a, m) => a + toNum(m.pendiente), 0) * 100) / 100;
    const [res] = await conn.execute(
      `INSERT INTO RPJ_PRC_CANCELACION_DEUDA (cde_id_jubilado, cde_fecha, cde_documento, cde_observaciones, cde_monto, cde_meses, cde_usuario_creacion)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, fecha, documento.slice(0, 100), String(body?.observaciones || "").trim().slice(0, 500) || null, total, meses.length, usuario]
    );
    const nota = `Cancelada fuera del sistema (${documento.slice(0, 60)})`;
    for (const m of meses) {
      await conn.execute(
        "INSERT INTO RPJ_PRC_CANCELACION_DEUDA_DET (cdd_id_cancelacion, cdd_id_deuda, cdd_periodo, cdd_monto) VALUES (?, ?, ?, ?)",
        [res.insertId, m.id, m.periodo, toNum(m.pendiente)]
      );
      await conn.execute(
        `UPDATE RPJ_PRC_DEUDA_JUBILADO
            SET deu_monto_pagado = deu_monto_pagado + deu_monto_pendiente, deu_monto_pendiente = 0,
                deu_estado = 'PAGADA', deu_fecha_saldada = ?,
                deu_observaciones = LEFT(CONCAT(COALESCE(CONCAT(deu_observaciones, ' | '), ''), ?), 250)
          WHERE deu_correlativo = ?`, [fecha, nota, m.id]
      );
    }
    const recalculadas = await recalcularBeneficiariosGenerados(conn, usuario);
    await conn.commit();
    logger.info("Deuda de fallecido cancelada fuera del sistema", { idJubilado: id, total, meses: meses.length, documento, usuario });
    return { id: Number(id), total, meses: meses.length, planillasRecalculadas: recalculadas };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Devuelve a pendiente los meses de una cancelación y la marca REVERTIDA.
const deshacerCancelacion = async (conn, idCancelacion, usuario, motivo) => {
  const c = { id: idCancelacion };
  const body = { motivo };
    const [det] = await conn.query("SELECT cdd_id_deuda AS idDeuda, cdd_monto AS monto FROM RPJ_PRC_CANCELACION_DEUDA_DET WHERE cdd_id_cancelacion = ?", [c.id]);
    for (const d of det) {
      await conn.execute(
        `UPDATE RPJ_PRC_DEUDA_JUBILADO
            SET deu_monto_pagado = deu_monto_pagado - ?, deu_monto_pendiente = deu_monto_pendiente + ?, deu_fecha_saldada = NULL
          WHERE deu_correlativo = ?`, [toNum(d.monto), toNum(d.monto), d.idDeuda]
      );
      // El estado se recalcula aparte, con los montos ya actualizados.
      await conn.execute(
        `UPDATE RPJ_PRC_DEUDA_JUBILADO
            SET deu_estado = CASE WHEN deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
          WHERE deu_correlativo = ?`, [d.idDeuda]
      );
    }
    await conn.execute(
      `UPDATE RPJ_PRC_CANCELACION_DEUDA SET cde_estado = 'REVERTIDA', cde_fecha_reversion = NOW(), cde_usuario_reversion = ?,
              cde_observaciones = LEFT(CONCAT(COALESCE(CONCAT(cde_observaciones, ' | '), ''), 'Revertida: ', ?), 500)
        WHERE cde_correlativo = ?`, [usuario, String(body?.motivo || "sin motivo").slice(0, 200), c.id]
    );
};

// Revierte la cancelación: los meses vuelven a quedar pendientes. No se permite si
// ya se cerró una planilla de jubilados después de registrarla (ya se pagó viudez).
const revertirCancelacionDeuda = async (id, body, currentUser) => {
  const usuario = currentUser?.usuario || "sistema";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const c = await cancelacionVigente(id, conn);
    if (!c) throw createError("Este jubilado no tiene una cancelación de deuda vigente", 404);
    const [[cer]] = await conn.query(
      `SELECT GROUP_CONCAT(DISTINCT p.ppl_numero ORDER BY p.ppl_numero) AS planillas
         FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
        WHERE i.nin_id_jubilado = ? AND i.nin_id_beneficiario IS NOT NULL AND p.ppl_estado_proceso = 'CERRADA'
          AND p.ppl_fecha_cierre >= ?`, [id, c.registrada]
    );
    if (cer?.planillas) {
      throw createError(`Ya se cerró la planilla ${cer.planillas} con sus beneficiarios después de registrar la cancelación: no se puede revertir`, 409);
    }
    await deshacerCancelacion(conn, c.id, usuario, body?.motivo);
    const recalculadas = await recalcularBeneficiariosGenerados(conn, usuario);
    await conn.commit();
    logger.info("Cancelación de deuda revertida", { idJubilado: id, cancelacion: c.id, usuario });
    return { id: Number(id), planillasRecalculadas: recalculadas };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------------
// Un solo mes de la deuda pagado fuera del sistema (por ejemplo enero 2023, que
// ya se canceló cuando la deuda de todos pasó a empezar en 202302). Solo toca a
// este jubilado y ese mes; queda el documento y se puede revertir.
// ---------------------------------------------------------------------------
const cancelacionMesVigente = async (conn, idJubilado, periodo) => {
  const [[c]] = await conn.query(
    `SELECT c.cde_correlativo AS id FROM RPJ_PRC_CANCELACION_DEUDA c
       JOIN RPJ_PRC_CANCELACION_DEUDA_DET d ON d.cdd_id_cancelacion = c.cde_correlativo
      WHERE c.cde_id_jubilado = ? AND c.cde_tipo = 'MES' AND c.cde_estado = 'VIGENTE' AND d.cdd_periodo = ?
      ORDER BY c.cde_correlativo DESC LIMIT 1`, [idJubilado, periodo]
  );
  return c || null;
};

// Fecha y documento son opcionales: por defecto hoy y "Confirmado en estado de cuenta"
// (queda el usuario que lo confirmó).
const cancelarMesDeuda = async (id, periodo, body, currentUser) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const fecha = String(body?.fecha || hoy).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw createError("La fecha no es válida");
  if (fecha > hoy) throw createError("La fecha no puede ser futura");
  const usuario = currentUser?.usuario || "sistema";
  const documento = String(body?.documento || "").trim() || `Confirmado en estado de cuenta (${usuario})`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[m]] = await conn.query(
      `SELECT deu_correlativo AS id, deu_monto_pendiente AS pendiente FROM RPJ_PRC_DEUDA_JUBILADO
        WHERE deu_id_jubilado = ? AND deu_periodo = ? AND deu_id_beneficiario IS NULL LIMIT 1 FOR UPDATE`, [id, periodo]
    );
    if (!m) throw createError("Ese mes no tiene deuda", 404);
    const pendiente = toNum(m.pendiente);
    if (!(pendiente > 0)) throw createError("Ese mes ya no tiene saldo pendiente", 409);
    const [res] = await conn.execute(
      `INSERT INTO RPJ_PRC_CANCELACION_DEUDA (cde_id_jubilado, cde_tipo, cde_fecha, cde_documento, cde_observaciones, cde_monto, cde_meses, cde_usuario_creacion)
       VALUES (?, 'MES', ?, ?, ?, ?, 1, ?)`,
      [id, fecha, documento.slice(0, 100), String(body?.observaciones || "").trim().slice(0, 500) || null, pendiente, usuario]
    );
    await conn.execute(
      "INSERT INTO RPJ_PRC_CANCELACION_DEUDA_DET (cdd_id_cancelacion, cdd_id_deuda, cdd_periodo, cdd_monto) VALUES (?, ?, ?, ?)",
      [res.insertId, m.id, Number(periodo), pendiente]
    );
    await conn.execute(
      `UPDATE RPJ_PRC_DEUDA_JUBILADO
          SET deu_monto_pagado = deu_monto_pagado + deu_monto_pendiente, deu_monto_pendiente = 0,
              deu_estado = 'PAGADA', deu_fecha_saldada = ?,
              deu_observaciones = LEFT(CONCAT(COALESCE(CONCAT(deu_observaciones, ' | '), ''), ?), 250)
        WHERE deu_correlativo = ?`, [fecha, `Mes pagado fuera del sistema (${documento.slice(0, 60)})`, m.id]
    );
    const recalculadas = await recalcularBeneficiariosGenerados(conn, usuario);
    await conn.commit();
    logger.info("Mes de deuda pagado fuera del sistema", { idJubilado: id, periodo, monto: pendiente, documento, usuario });
    return { id: Number(id), periodo: Number(periodo), monto: pendiente, planillasRecalculadas: recalculadas };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const revertirCancelacionMes = async (id, periodo, body, currentUser) => {
  const usuario = currentUser?.usuario || "sistema";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const c = await cancelacionMesVigente(conn, id, periodo);
    if (!c) throw createError("Ese mes no está marcado como pagado fuera del sistema", 404);
    await deshacerCancelacion(conn, c.id, usuario, body?.motivo);
    const recalculadas = await recalcularBeneficiariosGenerados(conn, usuario);
    await conn.commit();
    logger.info("Mes pagado fuera del sistema revertido", { idJubilado: id, periodo, cancelacion: c.id, usuario });
    return { id: Number(id), periodo: Number(periodo), planillasRecalculadas: recalculadas };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------------
// Ajuste de descuentos de un mes de la historia (meses de la carga histórica).
// Sirve para cuadrar, por ejemplo, el último mes de un préstamo cuyo saldo era
// menor a la cuota. Al guardar: líquido = pensión − descuentos; "recibido en el
// mes" = líquido × % de la planilla (como lo calculó la carga); la deuda del mes
// vale su líquido y su pendiente = líquido − lo ya abonado.
// ---------------------------------------------------------------------------
const mesHistoria = async (idJubilado, periodo, conn = pool) => {
  const [[pl]] = await conn.query(
    `SELECT p.ppl_correlativo AS id, p.ppl_numero AS numero, p.ppl_estado_proceso AS estado, p.ppl_tipo_planilla AS tipo
       FROM RPJ_CAT_PARAMETRO_PLANILLA p
       JOIN RPJ_PRC_NOMINA_INGRESO i ON i.nin_id_planilla = p.ppl_correlativo AND i.nin_id_jubilado = ? AND i.nin_id_beneficiario IS NULL
      WHERE p.ppl_numero = ? AND p.ppl_tipo_planilla IN (2, 4) AND p.ppl_estado_proceso <> 'REVERSADA'
      ORDER BY p.ppl_correlativo DESC LIMIT 1`, [idJubilado, periodo]
  );
  if (!pl) throw createError("No hay planilla de ese mes para el jubilado", 404);
  const [ingresos] = await conn.query(
    `SELECT nin_correlativo AS id, nin_tipo_ingreso AS tipo, nin_valor AS valor, nin_valor_teorico AS pension,
            nin_porcentaje_aplicado AS pct, nin_pago_corriente AS pagoCorriente, nin_abono_historico AS abono
       FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = ? AND nin_id_jubilado = ? AND nin_id_beneficiario IS NULL`, [pl.id, idJubilado]
  );
  const [descuentos] = await conn.query(
    `SELECT d.nde_correlativo AS id, d.nde_tipo_descuento AS tipo, COALESCE(t.tde_descripcion, 'DESCUENTO') AS descripcion, d.nde_valor AS valor
       FROM RPJ_PRC_NOMINA_DESCUENTO d LEFT JOIN RPJ_CAT_TIPO_DESCUENTO t ON t.tde_id = d.nde_tipo_descuento
      WHERE d.nde_id_planilla = ? AND d.nde_id_jubilado = ? AND d.nde_id_beneficiario IS NULL ORDER BY d.nde_correlativo`, [pl.id, idJubilado]
  );
  const [[deu]] = await conn.query(
    `SELECT deu_correlativo AS id, deu_monto_original AS original, deu_monto_pagado AS pagado, deu_monto_pendiente AS pendiente,
            deu_estado AS estado, deu_observaciones AS obs
       FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ? AND deu_periodo = ? AND deu_id_beneficiario IS NULL LIMIT 1`, [idJubilado, periodo]
  );
  const [[abonos]] = await conn.query(
    "SELECT COUNT(*) AS n FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = ? AND apa_id_jubilado = ?", [pl.id, idJubilado]
  );
  // Solo meses de la carga histórica: su planilla está cerrada, el mes tiene deuda,
  // hay un solo ingreso y esa planilla no abonó a otros meses (no se cerró en el sistema).
  let motivo = null;
  if (pl.estado !== "CERRADA") motivo = "La planilla de ese mes no está cerrada: edítela desde la planilla.";
  else if (!deu) motivo = "Ese mes no tiene deuda (se pagó completo).";
  else if (ingresos.length !== 1) motivo = "Ese mes tiene varios ingresos: edítelo desde la planilla.";
  else if (toNum(abonos.n) > 0) motivo = "La planilla de ese mes ya abonó a la deuda: no se cambia desde aquí.";
  const ing = ingresos[0] || {};
  return {
    planilla: pl, periodo: Number(periodo), editable: !motivo, motivo,
    pension: toNum(ing.pension), porcentaje: toNum(ing.pct || 50), recibido: Math.round((toNum(ing.valor) - descuentos.reduce((a, x) => a + toNum(x.valor), 0)) * 100) / 100,
    ingreso: ing.id ? { id: ing.id, valor: toNum(ing.valor) } : null,
    descuentos: descuentos.map((x) => ({ ...x, valor: toNum(x.valor) })),
    deuda: deu ? { id: deu.id, original: toNum(deu.original), pagado: toNum(deu.pagado), pendiente: toNum(deu.pendiente), estado: deu.estado } : null
  };
};

const tiposDescuento = async () => (await pool.query("SELECT tde_id AS id, tde_descripcion AS descripcion FROM RPJ_CAT_TIPO_DESCUENTO ORDER BY tde_id"))[0];

const descuentosMes = async (idJubilado, periodo) => ({ ...(await mesHistoria(idJubilado, periodo)), tipos: await tiposDescuento() });

// payload: { descuentos: [{ id?, tipo, valor }] } con TODOS los descuentos del mes
// (los que no vengan se borran).
const editarDescuentosMes = async (idJubilado, periodo, payload, currentUser) => {
  const lista = Array.isArray(payload?.descuentos) ? payload.descuentos : [];
  for (const x of lista) {
    if (!(Number(x.tipo) > 0)) throw createError("Cada descuento necesita su tipo");
    if (Number.isNaN(Number(x.valor)) || Number(x.valor) < 0) throw createError("Los montos de descuento deben ser números mayores o iguales a 0");
  }
  const usuario = currentUser?.usuario || "sistema";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const m = await mesHistoria(idJubilado, periodo, conn);
    if (!m.editable) throw createError(m.motivo, 409);
    const total = Math.round(lista.reduce((a, x) => a + Number(x.valor), 0) * 100) / 100;
    if (total > m.pension) throw createError(`Los descuentos (Q${total.toFixed(2)}) no pueden ser mayores que la pensión (Q${m.pension.toFixed(2)})`);
    const antes = m.descuentos.map((d) => `${d.descripcion} ${d.valor.toFixed(2)}`).join(", ");

    // Descuentos: actualizar, agregar y borrar.
    const ids = new Set(lista.filter((x) => x.id).map((x) => Number(x.id)));
    const borrar = m.descuentos.filter((d) => !ids.has(Number(d.id))).map((d) => d.id);
    if (borrar.length) await conn.query("DELETE FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_correlativo IN (?) AND nde_id_planilla = ? AND nde_id_jubilado = ?", [borrar, m.planilla.id, idJubilado]);
    const [[base]] = await conn.query(
      "SELECT nin_tipo_manejo AS tm, nin_id_tipo_planilla AS tp, nin_dias_trabajados AS dias, nin_puesto AS puesto, nin_area AS area FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_correlativo = ?", [m.ingreso.id]
    );
    for (const x of lista) {
      const valor = Math.round(Number(x.valor) * 100) / 100;
      if (x.id && m.descuentos.some((d) => Number(d.id) === Number(x.id))) {
        await conn.execute("UPDATE RPJ_PRC_NOMINA_DESCUENTO SET nde_valor = ?, nde_tipo_descuento = ? WHERE nde_correlativo = ? AND nde_id_jubilado = ?", [valor, Number(x.tipo), x.id, idJubilado]);
      } else if (valor > 0) {
        await conn.execute(
          `INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor,
             nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [base.tm, base.tp, m.planilla.id, idJubilado, Number(x.tipo), valor, base.dias || 30, base.puesto || "JUBILADO", base.area || "JUBILADOS", usuario]
        );
      }
    }

    // Líquido, recibido (al % de la planilla) y deuda del mes.
    const liquido = Math.max(Math.round((m.pension - total) * 100) / 100, 0);
    const recibido = Math.round(liquido * m.porcentaje) / 100;
    await conn.execute(
      "UPDATE RPJ_PRC_NOMINA_INGRESO SET nin_valor = ?, nin_pago_corriente = ? WHERE nin_correlativo = ?",
      [Math.round((recibido + total) * 100) / 100, recibido, m.ingreso.id]
    );
    const nota = `Ajuste de descuentos ${new Date().toISOString().slice(0, 10)} (${usuario}): antes ${antes || "sin descuentos"}`;
    await conn.execute(
      `UPDATE RPJ_PRC_DEUDA_JUBILADO
          SET deu_monto_original = ?, deu_monto_pendiente = GREATEST(? - deu_monto_pagado, 0),
              deu_observaciones = LEFT(CONCAT(COALESCE(CONCAT(deu_observaciones, ' | '), ''), ?), 250)
        WHERE deu_correlativo = ?`, [liquido, liquido, nota, m.deuda.id]
    );
    // El estado se recalcula aparte, con los montos ya actualizados.
    await conn.execute(
      `UPDATE RPJ_PRC_DEUDA_JUBILADO
          SET deu_estado = CASE WHEN deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END,
              deu_fecha_saldada = CASE WHEN deu_monto_pendiente <= 0 THEN COALESCE(deu_fecha_saldada, CURDATE()) ELSE NULL END
        WHERE deu_correlativo = ?`, [m.deuda.id]
    );
    await conn.commit();
    logger.info("Descuentos de un mes de la historia ajustados", { idJubilado, periodo, antes, total, liquido, recibido, usuario });
    return { ...(await mesHistoria(idJubilado, periodo)), liquido };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------------
// Liquidación de la deuda del jubilado (PDF): lo que se le debe mes a mes, el total
// y a quién se traslada si falleció (el cónyuge la cobra con la regla de la planilla).
// Solo documento: no mueve dinero.
// ---------------------------------------------------------------------------
const liquidacionPdf = async (id, user, opciones = {}) => {
  const L = require("../utils/pdfLayout");
  const { numeroALetras } = require("../utils/numeroALetras");
  const resumen = await resumenFinanciero(id);
  const historia = await historiaCompleta(id);
  const [[jub]] = await pool.execute(
    `SELECT jub_id AS codigo, CONCAT(jub_nombres, ' ', jub_apellidos) AS nombre, jub_dpi AS dpi, jub_fecha_jubilacion AS fechaJubilacion,
            jub_estado_pago AS estadoPago, jub_fecha_fallecimiento AS fechaFallecimiento,
            (SELECT tju_descripcion FROM RPJ_CAT_TIPO_JUBILACION WHERE tju_id = jub_tipo_jubilacion) AS tipo
       FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?`, [id]
  );
  const [bens] = await pool.query(
    `SELECT ben_correlativo AS id, TRIM(CONCAT(COALESCE(ben_nombres, ''), ' ', ben_apellidos)) AS nombre, ben_tipo_parentesco AS parentesco,
            ben_monto AS monto, ben_porcentaje AS pct, ben_estado AS estado
       FROM RPJ_MNT_BENEFICIARIO WHERE ben_id_jubilado = ? AND ben_estado <> 'INACTIVO' ORDER BY ben_correlativo`, [id]
  );
  const MES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const per = (p) => { const n = Number(p); return nombrePrestacion(n) || `${MES[(n % 100) - 1]} ${Math.floor(n / 100)}`; };
  const Q = (n) => `Q${L.q(n)}`;
  const deuda = historia.filter((h) => h.esDeuda);
  const tot = (k) => Math.round(deuda.reduce((a, h) => a + toNum(h[k]), 0) * 100) / 100;
  const totalDeuda = tot("montoGenerado");
  const totalAbonado = tot("montoPagado");
  const totalPendiente = tot("saldo");

  const doc = L.nuevoDoc(L.CARTA);
  const ancho = L.anchoUtil(doc);
  const x0 = doc.page.margins.left;
  const cabecera = (d) => L.encabezado(d, {
    titulo: "LIQUIDACIÓN DE DEUDA CON EL JUBILADO", institucion: L.INSTITUCION_CORTA,
    subtitulo: `${jub.codigo} — ${jub.nombre}  ·  al ${L.fecha(new Date())}`
  });
  cabecera(doc);

  const datos = [
    ["Código", jub.codigo], ["DPI", jub.dpi || "—"], ["Tipo de jubilación", jub.tipo || "—"], ["Pensión mensual", Q(resumen.pension)],
    ["Fecha de jubilación", L.fecha(jub.fechaJubilacion)],
    [jub.estadoPago === "FALLECIDO" ? "Fecha de fallecimiento" : "Estado", jub.estadoPago === "FALLECIDO" ? L.fecha(jub.fechaFallecimiento) : jub.estadoPago],
    ["Meses con deuda", String(deuda.length)], ["Meses pendientes", String(deuda.filter((h) => toNum(h.saldo) > 0).length)]
  ];
  const col = ancho / 4;
  let y = doc.y;
  datos.forEach(([k, v], i) => {
    const x = x0 + (i % 4) * col;
    if (i % 4 === 0 && i > 0) y += 24;
    doc.font("Helvetica").fontSize(7).fillColor("#666666").text(k, x, y, { width: col - 6 });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000").text(String(v), x, y + 8, { width: col - 6, lineBreak: false, ellipsis: true });
  });
  doc.y = y + 30;

  // Resumen en recuadro.
  const yR = doc.y;
  doc.save().roundedRect(x0, yR, ancho, 44, 4).fill("#F3F6F8").restore();
  const tres = [["Total que se le debía", Q(totalDeuda)], ["Abonado", Q(totalAbonado)], ["Deuda pendiente", Q(totalPendiente)]];
  tres.forEach(([k, v], i) => {
    const x = x0 + 10 + i * (ancho / 3);
    doc.font("Helvetica").fontSize(7.5).fillColor("#555555").text(k, x, yR + 8, { width: ancho / 3 - 20 });
    doc.font("Helvetica-Bold").fontSize(i === 2 ? 13 : 11).fillColor(i === 2 ? "#B00020" : "#1F4E5F").text(v, x, yR + 20, { width: ancho / 3 - 20 });
  });
  doc.fillColor("#000000");
  doc.y = yR + 52;
  doc.font("Helvetica").fontSize(8).text(`Deuda pendiente: ${numeroALetras(totalPendiente)}`, x0, doc.y, { width: ancho });
  doc.moveDown(0.6);

  // Traslado.
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#1F4E5F").text("Traslado de la deuda", x0, doc.y, { width: ancho }).fillColor("#000000");
  doc.moveDown(0.2);
  const conyuge = bens.find((b) => ["ESPOSA", "ESPOSO"].includes(String(b.parentesco).toUpperCase()));
  const cancel = resumen.fallecimiento?.cancelacion;
  const pct = 50;
  let texto;
  if (cancel) {
    texto = `La deuda del fallecido se registró como pagada fuera del sistema el ${L.fecha(cancel.fecha)} (${cancel.documento}) por ${Q(cancel.monto)}.`;
  } else if (totalPendiente <= 0) {
    texto = "El jubilado no tiene deuda pendiente.";
  } else if (conyuge) {
    // Último líquido completo: el mes del fallecimiento pagado proporcional no cuenta.
    const completos = deuda.filter((h) => !h.proporcional && h.ingreso === "PENSIÓN");
    const base = completos.length ? completos : deuda;
    const ultimo = base.length ? toNum(base[base.length - 1].montoGenerado) : 0;
    const cuota = Math.round(ultimo * pct) / 100;
    texto = `${jub.estadoPago === "FALLECIDO" ? "Por el fallecimiento del jubilado, la" : "Si el jubilado fallece, la"} deuda pendiente de ${Q(totalPendiente)} se traslada a su cónyuge `
      + `${conyuge.nombre} (${conyuge.parentesco}), quien la cobra en la planilla de jubilados: ${Q(cuota)} por mes (el ${pct}% de su último líquido), `
      + `abonando del mes más antiguo al más nuevo${cuota > 0 ? `, en aproximadamente ${Math.ceil(totalPendiente / cuota)} meses` : ""}. Al terminarla pasa a cobrar su pensión por viudez.`;
  } else {
    texto = `No hay cónyuge registrado como beneficiario: la deuda pendiente de ${Q(totalPendiente)} queda a favor de quien determine la resolución correspondiente.`;
  }
  doc.font("Helvetica").fontSize(8.5).text(texto, x0, doc.y, { width: ancho, align: "justify" });
  if (bens.length) {
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(7.5).fillColor("#444444")
      .text(`Beneficiarios registrados: ${bens.map((b) => `${b.nombre} (${b.parentesco}${b.monto ? `, ${Q(b.monto)}/mes` : ""})`).join("; ")}.`, x0, doc.y, { width: ancho })
      .fillColor("#000000");
  }
  doc.moveDown(0.6);

  // Detalle mes a mes.
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#1F4E5F").text("Detalle de la deuda por mes", x0, doc.y, { width: ancho }).fillColor("#000000");
  doc.moveDown(0.2);
  const anchos = L.repartirAnchos(doc, [10, 13, 13, 13, 13, 13, 13, 12]);
  const columnas = [
    { titulo: "MES", valor: (f) => per(f.periodo), ancho: anchos[0] },
    { titulo: "PENSIÓN", campo: "pensionCompleta", valor: (f) => L.q(f.pensionCompleta), align: "right", ancho: anchos[1] },
    { titulo: "DESCUENTOS", campo: "descuentos", valor: (f) => L.q(f.descuentos), align: "right", ancho: anchos[2] },
    { titulo: "SE LE DEBÍA", campo: "montoGenerado", valor: (f) => L.q(f.montoGenerado), align: "right", ancho: anchos[3] },
    { titulo: "RECIBIDO", campo: "recibidoMes", valor: (f) => L.q(f.recibidoMes), align: "right", ancho: anchos[4] },
    { titulo: "ABONADO", campo: "montoPagado", valor: (f) => L.q(f.montoPagado), align: "right", ancho: anchos[5] },
    { titulo: "PENDIENTE", campo: "saldo", valor: (f) => L.q(f.saldo), align: "right", ancho: anchos[6] },
    { titulo: "ESTADO", campo: "estado", ancho: anchos[7] }
  ];
  L.dibujarTabla(doc, columnas, deuda, { fuente: 7, alturaFila: 12, altoEncabezado: 16, reservaInferior: 90, alRepetirEncabezado: cabecera });
  L.filaTotales(doc, columnas, {
    descuentos: L.q(tot("descuentos")), montoGenerado: L.q(totalDeuda), recibidoMes: L.q(tot("recibidoMes")),
    montoPagado: L.q(totalAbonado), saldo: L.q(totalPendiente)
  }, "TOTALES", 2, { fuente: 7 });
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(7).fillColor("#555555").text(
    "Regla: desde enero 2023 cada mes se debe completo (su líquido = pensión − descuentos); lo recibido antes de la regla no se abona a la deuda; "
    + "cada planilla cerrada abona su pago al mes pendiente más antiguo.", x0, doc.y, { width: ancho }).fillColor("#000000");

  let firmas = [];
  try { firmas = opciones.firmas ? JSON.parse(opciones.firmas) : []; } catch { firmas = []; }
  if (!firmas.length) firmas = [{ rol: "Elaborado por" }, { rol: "Revisado por" }, { rol: "Autorizado por" }];
  doc.moveDown(2);
  L.bloqueFirmas(doc, firmas);
  L.marcaImpresion(doc);
  logger.info("Liquidación de deuda generada", { idJubilado: id, totalPendiente, usuario: user?.usuario });
  return { buffer: await L.aBuffer(doc), filename: `liquidacion_deuda_${jub.codigo}.pdf` };
};

// PDF de estado de cuenta (carta). Mismo estilo de los reportes formales
// (utils/pdfLayout): encabezado institucional con logo, datos del jubilado,
// resumen, explicación y el detalle mes a mes de la deuda.
const generarEstadoCuentaPdf = async (id, usuario) => {
  const L = require("../utils/pdfLayout");
  const resumen = await resumenFinanciero(id);
  const historia = await historiaCompleta(id);
  const [[jub]] = await pool.execute(
    "SELECT jub_fecha_jubilacion AS fechaJubilacion FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?", [id]);

  const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const per = (p) => { const n = Number(p); return nombrePrestacion(n) || `${MES[(n % 100) - 1]}-${Math.floor(n / 100)}`; };
  const Q = (n) => `Q ${L.q(n)}`;

  const completos = historia.filter((h) => !h.esDeuda);
  const deuda = historia.filter((h) => h.esDeuda);
  const pendientes = deuda.filter((h) => h.saldo > 0);
  const totalDevengado = deuda.reduce((s, h) => s + h.montoGenerado, 0);
  const totalAbonado = deuda.reduce((s, h) => s + h.montoPagado, 0);
  const totalRecibido = deuda.reduce((s, h) => s + h.recibidoMes, 0);
  const saldo = deuda.reduce((s, h) => s + h.saldo, 0);

  const doc = L.nuevoDoc({ ...L.CARTA, margins: { top: 36, bottom: 40, left: 40, right: 40 } });
  const x0 = doc.page.margins.left;
  const ancho = L.anchoUtil(doc);

  L.encabezado(doc, {
    titulo: "Estado de cuenta de jubilado",
    subtitulo: `Saldo al ${L.fechaLarga()}`
  });

  // --- Datos del jubilado --------------------------------------------------
  const caja = (y, alto, color = "#F3F6F8") => doc.save().roundedRect(x0, y, ancho, alto, 4).fill(color).restore();
  let y = doc.y + 4;
  caja(y, 54);
  const dato = (etq, val, cx, cy, w) => {
    doc.font("Helvetica").fontSize(7).fillColor("#5A6B7B").text(etq, cx, cy, { width: w });
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000").text(String(val ?? ""), cx, cy + 9, { width: w, lineBreak: false, ellipsis: true });
  };
  const c4 = ancho / 4;
  dato("Jubilado", resumen.nombreCompleto, x0 + 10, y + 7, c4 * 2 - 10);
  dato("DPI", resumen.dpi || "-", x0 + c4 * 2, y + 7, c4 - 6);
  dato("Código", resumen.idJubilado ?? resumen.id, x0 + c4 * 3, y + 7, c4 - 10);
  dato("Fecha de jubilación", jub?.fechaJubilacion ? L.fecha(jub.fechaJubilacion) : "-", x0 + 10, y + 30, c4 - 10);
  dato("Pensión mensual", Q(resumen.pension), x0 + c4, y + 30, c4 - 6);
  dato("Tipo de pago", resumen.tipoPago, x0 + c4 * 2, y + 30, c4 - 6);
  dato("Estado de pago", resumen.estadoPago, x0 + c4 * 3, y + 30, c4 - 10);
  y += 64;

  // --- Resumen -------------------------------------------------------------
  const tarjeta = (i, etq, val, destacado) => {
    const w = (ancho - 18) / 4;
    const cx = x0 + i * (w + 6);
    doc.save().roundedRect(cx, y, w, 42, 4).fill(destacado ? "#FDECEA" : "#FFFFFF").restore();
    doc.save().roundedRect(cx, y, w, 42, 4).lineWidth(0.6).strokeColor(destacado ? "#E57373" : "#C9D3DC").stroke().restore();
    doc.font("Helvetica").fontSize(6.8).fillColor("#5A6B7B").text(etq, cx + 6, y + 7, { width: w - 12, align: "center" });
    doc.font("Helvetica-Bold").fontSize(destacado ? 12 : 10.5).fillColor(destacado ? "#C62828" : "#1F4E5F")
      .text(val, cx + 6, y + 21, { width: w - 12, align: "center", lineBreak: false });
  };
  tarjeta(0, "Total devengado (meses con deuda)", Q(totalDevengado));
  tarjeta(1, "Abonado a la deuda", Q(totalAbonado));
  tarjeta(2, "Meses con saldo pendiente", `${pendientes.length} de ${deuda.length}`);
  tarjeta(3, "SALDO PENDIENTE", Q(saldo), true);
  y += 50;

  // --- Explicación ---------------------------------------------------------
  doc.font("Helvetica").fontSize(7).fillColor("#333333");
  const desde = deuda.length ? per(deuda[0].periodo) : "-";
  const masAntiguo = pendientes.length ? per(pendientes[0].periodo) : "ninguno";
  const lineasCompletos = completos.length
    ? `Meses pagados completos (sin deuda): ${per(completos[0].periodo)} a ${per(completos[completos.length - 1].periodo)} (${completos.length} meses). `
    : "";
  doc.text(
    `${lineasCompletos}Desde ${desde} cada mes vale su líquido (pensión menos descuentos) y en cada planilla se paga el ` +
    `porcentaje vigente; lo recibido se abona al mes pendiente más antiguo. Mes pendiente más antiguo: ${masAntiguo}.`,
    x0, y, { width: ancho, align: "justify" });
  doc.y += 8;

  // --- Detalle -------------------------------------------------------------
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#1F4E5F").text("Detalle mensual de la deuda", x0, doc.y);
  doc.moveDown(0.3).fillColor("#000000");
  const anchos = L.repartirAnchos(doc, [1.1, 1.2, 1.1, 1.2, 1.3, 1.2, 1.2, 1.1]);
  const columnas = [
    { titulo: "Período", campo: "periodoTxt" },
    { titulo: "Pensión", campo: "pension", align: "right" },
    { titulo: "Descuentos", campo: "descuentos", align: "right" },
    { titulo: "Líquido del mes", campo: "liquido", align: "right" },
    { titulo: "Recibido en la planilla", campo: "recibido", align: "right" },
    { titulo: "Abonado a la deuda", campo: "abonado", align: "right" },
    { titulo: "Saldo", campo: "saldo", align: "right" },
    { titulo: "Estado", campo: "estado", align: "center" }
  ].map((c, i) => ({ ...c, ancho: anchos[i] }));
  const filas = deuda.map((h) => ({
    periodoTxt: per(h.periodo),
    pension: L.q(h.pensionCompleta),
    descuentos: L.q(Math.max(h.pensionCompleta - h.montoGenerado, 0)),
    liquido: L.q(h.montoGenerado),
    recibido: L.q(h.recibidoMes),
    abonado: L.q(h.montoPagado),
    saldo: L.q(h.saldo),
    estado: h.estado
  }));
  if (filas.length) {
    L.dibujarTabla(doc, columnas, filas, { fuente: 7, alturaFila: 13, altoEncabezado: 20, reservaInferior: 10 });
    L.filaTotales(doc, columnas, {
      liquido: L.q(totalDevengado), recibido: L.q(totalRecibido), abonado: L.q(totalAbonado), saldo: L.q(saldo), estado: ""
    }, "TOTALES", 3);
  } else {
    doc.font("Helvetica").fontSize(8).text("El jubilado no tiene meses con deuda registrados.", x0, doc.y);
  }

  doc.moveDown(2);
  L.bloqueFirmas(doc, [{ rol: "Elaborado por" }, { rol: "Revisado por" }]);
  L.pieDePagina(doc, usuario);
  return L.aBuffer(doc);
};

module.exports = {
  listarFallecidos, corregirFallecimiento, revertirFallecimiento, cancelarDeudaFallecido, revertirCancelacionDeuda, cancelarMesDeuda, revertirCancelacionMes,
  aplicarPrestacionesFallecimiento, calcularPrestacionesFallecimiento, esPrestacion, nombrePrestacion,
  formaCobro, guardarFormaCobro, convenioVigente,
  registrarFallecidoEnServicio, descuentosMes, editarDescuentosMes, liquidacionPdf,
  buscar, noAmparistas, deudaTotal, beneficiariosRegistrados, beneficiariosActivos,
  resumenFinanciero, ultimosPagos, deudaDetalle, historiaCompleta, historiaDespuesDeFallecer, mesFallecimiento, registrarFallecimiento,
  generarEstadoCuentaPdf
};
