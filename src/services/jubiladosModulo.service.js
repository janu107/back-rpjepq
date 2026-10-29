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
  tieneTutora: Number(b.tutores) > 0
});
const SELECT_BEN = `SELECT ben_correlativo AS id, ben_tipo_parentesco AS tipoParentesco, ben_nombres AS nombres,
  ben_apellidos AS apellidos, ben_dpi AS dpi, ben_fecha_nacimiento AS fechaNacimiento,
  ben_porcentaje AS porcentaje, ben_estado AS estado,
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
  // Deuda: RPJ_PRC_DEUDA_JUBILADO es la tabla que llenan la carga histórica y la
  // nómina mensual (la que de verdad cobra). RPJ_MNT_DEUDA no la llena ningún
  // proceso; por eso antes todo salía en cero.
  const [[deu]] = await pool.execute(
    `SELECT COALESCE(SUM(CASE WHEN deu_estado IN ('PENDIENTE','PARCIAL') THEN deu_monto_pendiente ELSE 0 END),0) AS deudaPendiente,
            COALESCE(SUM(CASE WHEN deu_estado IN ('PENDIENTE','PARCIAL') THEN 1 ELSE 0 END),0) AS periodosDeuda,
            COALESCE(SUM(deu_monto_original),0) AS deudaGenerada
       FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ? AND deu_id_beneficiario IS NULL`, [id]
  );
  // Pagos: lo que realmente recibió (ingreso − descuentos) en las planillas de
  // jubilados (incluidas las históricas) y cuántos meses ha tenido pago.
  const [[pag]] = await pool.execute(
    `SELECT COALESCE(SUM(i.nin_valor),0)
            - COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d
                          INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA p2 ON p2.ppl_correlativo = d.nde_id_planilla
                         WHERE d.nde_id_jubilado = ? AND d.nde_id_beneficiario IS NULL AND d.nde_tipo_manejo = 2
                           AND p2.ppl_tipo_planilla IN (2, 4) AND p2.ppl_estado_proceso <> 'REVERSADA'), 0) AS totalPagado,
            COUNT(DISTINCT p.ppl_numero) AS periodosHistoria
       FROM RPJ_PRC_NOMINA_INGRESO i
       INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
      WHERE i.nin_id_jubilado = ? AND i.nin_id_beneficiario IS NULL AND i.nin_tipo_manejo = 2
        AND p.ppl_tipo_planilla IN (2, 4) AND p.ppl_estado_proceso <> 'REVERSADA'`, [id, id]
  );
  return {
    ...mapJubBusqueda(jub),
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
      ORDER BY p.ppl_numero DESC, i.nin_correlativo DESC LIMIT ?`,
    [id, lim]
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
const historiaCompleta = async (id) => {
  await assertJubilado(id);
  const [rows] = await pool.execute(
    `SELECT x.periodo,
            MAX(x.pension) AS pensionCompleta, MAX(x.porcentaje) AS porcentaje,
            SUM(x.pagado_mes) AS pagadoMes, MAX(x.fecha_pago) AS fechaPago,
            MAX(x.deuda_id) AS id, MAX(x.deuda_original) AS deudaOriginal,
            MAX(x.deuda_pagada) AS deudaPagada, MAX(x.deuda_pendiente) AS deudaPendiente,
            MAX(x.deuda_estado) AS deudaEstado, MAX(x.deuda_planilla) AS deudaPlanilla,
            SUM(x.descuentos) AS descuentos, MAX(x.detalle_desc) AS detalleDescuentos,
            MAX(x.en_proceso) AS enProceso, MAX(x.pagado_con) AS pagadoCon
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
                NULL AS pagado_con
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
                  WHERE a.apa_id_deuda = d.deu_correlativo) AS pagado_con
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
  return { beneficiariosActivados: toNum(out.p_ben), message: out.p_res };
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
            (SELECT COUNT(*) FROM RPJ_MNT_BENEFICIARIO b WHERE b.ben_id_jubilado = j.jub_correlativo) AS beneficiarios,
            (SELECT GROUP_CONCAT(DISTINCT p.ppl_numero ORDER BY p.ppl_numero SEPARATOR ', ')
               FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
              WHERE i.nin_id_jubilado = j.jub_correlativo AND i.nin_id_beneficiario IS NOT NULL
                AND p.ppl_estado_proceso = 'CERRADA') AS planillasCerradas,
            (SELECT GROUP_CONCAT(DISTINCT p.ppl_numero ORDER BY p.ppl_numero SEPARATOR ', ')
               FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
              WHERE i.nin_id_jubilado = j.jub_correlativo AND i.nin_id_beneficiario IS NOT NULL
                AND p.ppl_estado_proceso = 'GENERADA') AS planillasGeneradas
       FROM RPJ_MNT_JUBILADO j
      WHERE j.jub_estado_pago = 'FALLECIDO'
      ORDER BY j.jub_fecha_fallecimiento DESC, nombre`
  );
  return rows.map((r) => ({ ...r, beneficiarios: toNum(r.beneficiarios), editable: !r.planillasCerradas }));
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
  await pool.execute(
    "UPDATE RPJ_MNT_JUBILADO SET jub_fecha_fallecimiento = ?, jub_no_defuncion = ? WHERE jub_correlativo = ? AND jub_estado_pago = 'FALLECIDO'",
    [fecha, noDef.slice(0, 50), id]
  );
  await pool.execute(
    "UPDATE RPJ_MNT_BENEFICIARIO SET ben_fecha_activacion = ? WHERE ben_id_jubilado = ? AND ben_estado = 'ACTIVO'",
    [fecha, id]
  );
  logger.info("Fecha de fallecimiento corregida", { idJubilado: id, fecha, usuario: currentUser?.usuario });
  return { id: Number(id), fechaFallecimiento: fecha, aviso: avisoGeneradas(f) };
};

const revertirFallecimiento = async (id, body, currentUser) => {
  const f = await estadoFallecido(id);
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
  const per = (p) => { const n = Number(p); return `${MES[(n % 100) - 1]}-${Math.floor(n / 100)}`; };
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
  listarFallecidos, corregirFallecimiento, revertirFallecimiento,
  buscar, noAmparistas, deudaTotal, beneficiariosRegistrados, beneficiariosActivos,
  resumenFinanciero, ultimosPagos, deudaDetalle, historiaCompleta, registrarFallecimiento,
  generarEstadoCuentaPdf
};
