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

const buscar = async (q, estado) => {
  const term = String(q || "").trim();
  if (term.length < 3) return [];
  const like = `%${term}%`;
  const cond = ["(jub_nombres LIKE ? OR jub_apellidos LIKE ? OR jub_dpi LIKE ? OR CONCAT(jub_nombres,' ',jub_apellidos) LIKE ?)"];
  const params = [like, like, like, like];
  if (estado) { cond.push("jub_estado = ?"); params.push(String(estado).toUpperCase()); }
  const [rows] = await pool.query(`${SELECT_JUB} WHERE ${cond.join(" AND ")} ORDER BY jub_nombres, jub_apellidos LIMIT 20`, params);
  return rows.map(mapJubBusqueda);
};

const noAmparistas = async (q) => {
  const term = String(q || "").trim();
  const like = `%${term}%`;
  const filtro = term ? " AND (jub_nombres LIKE ? OR jub_apellidos LIKE ? OR jub_dpi LIKE ?)" : "";
  const params = term ? [like, like, like] : [];
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
    `SELECT COALESCE(SUM(deu_monto_pendiente), 0) AS deudaTotal, COUNT(*) AS periodos
       FROM RPJ_PRC_DEUDA_JUBILADO
      WHERE deu_id_jubilado = ? AND deu_es_deuda = 1 AND deu_estado IN ('PENDIENTE','PARCIAL')`,
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
  const [[deu]] = await pool.execute(
    `SELECT COALESCE(SUM(CASE WHEN deu_es_deuda=1 AND deu_estado IN ('PENDIENTE','PARCIAL') THEN deu_monto_pendiente ELSE 0 END),0) AS deudaPendiente,
            COALESCE(SUM(CASE WHEN deu_es_deuda=1 AND deu_estado IN ('PENDIENTE','PARCIAL') THEN 1 ELSE 0 END),0) AS periodosDeuda,
            COALESCE(SUM(CASE WHEN deu_es_deuda=0 THEN 1 ELSE 0 END),0) AS periodosHistoria,
            COALESCE(SUM(deu_monto_pagado),0) AS totalPagado
       FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ?`, [id]
  );
  return {
    ...mapJubBusqueda(jub),
    pension: toNum(pen ? pen.pension : 0),
    deudaPendiente: toNum(deu.deudaPendiente),
    periodosDeuda: toNum(deu.periodosDeuda),
    periodosHistoria: toNum(deu.periodosHistoria),
    totalPagado: toNum(deu.totalPagado)
  };
};

const ultimosPagos = async (id, limit) => {
  await assertJubilado(id);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 60);
  const [rows] = await pool.query(
    `SELECT i.nin_correlativo AS id, i.nin_id_planilla AS idPlanilla, p.ppl_numero AS periodo,
            p.ppl_fecha_pago AS fechaPago, i.nin_valor AS total, i.nin_pago_corriente AS pagoCorriente,
            i.nin_abono_historico AS abono, i.nin_id_tipo_planilla AS tipoPlanilla
       FROM RPJ_PRC_NOMINA_INGRESO i
       LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
      WHERE i.nin_id_jubilado = ? AND i.nin_tipo_manejo = 2 AND i.nin_id_beneficiario IS NULL
      ORDER BY i.nin_correlativo DESC LIMIT ?`,
    [id, lim]
  );
  return rows.map((r) => ({
    id: r.id, idPlanilla: r.idPlanilla, periodo: r.periodo, fechaPago: r.fechaPago,
    total: toNum(r.total), pagoCorriente: toNum(r.pagoCorriente), abono: toNum(r.abono), tipoPlanilla: r.tipoPlanilla
  }));
};

const mapDeuda = (d) => ({
  id: d.id, periodo: d.periodo, esDeuda: Boolean(d.esDeuda), tipoPago: d.tipoPago,
  pensionCompleta: toNum(d.pensionCompleta), montoPagado: toNum(d.montoPagado),
  saldo: toNum(d.saldo), estado: d.estado, fechaGeneracion: d.fechaGeneracion
});
const SELECT_DEUDA = `SELECT deu_correlativo AS id, deu_periodo AS periodo, deu_es_deuda AS esDeuda,
  deu_tipo_pago AS tipoPago, deu_monto_original AS pensionCompleta, deu_monto_pagado AS montoPagado,
  deu_monto_pendiente AS saldo, deu_estado AS estado, deu_fecha_generacion AS fechaGeneracion
  FROM RPJ_PRC_DEUDA_JUBILADO`;

const deudaDetalle = async (id) => {
  await assertJubilado(id);
  const [rows] = await pool.execute(`${SELECT_DEUDA} WHERE deu_id_jubilado = ? AND deu_es_deuda = 1 ORDER BY deu_periodo`, [id]);
  return rows.map(mapDeuda);
};

const historiaCompleta = async (id) => {
  await assertJubilado(id);
  const [rows] = await pool.execute(`${SELECT_DEUDA} WHERE deu_id_jubilado = ? ORDER BY deu_periodo`, [id]);
  return rows.map(mapDeuda);
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

// PDF de estado de cuenta (pdfkit). Reutiliza resumenFinanciero + historiaCompleta.
const generarEstadoCuentaPdf = async (id) => {
  const resumen = await resumenFinanciero(id);
  const deudas = await historiaCompleta(id);
  const Q = (n) => `Q${Number(n || 0).toFixed(2)}`;
  const perF = (p) => { const s = String(p); return s.length === 6 ? `${s.slice(4, 6)}/${s.slice(0, 4)}` : s; };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "LETTER" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).fillColor("#1F4E79").text("Estado de Cuenta — Jubilado", { align: "center" });
    doc.moveDown(0.5).fillColor("#000").fontSize(10);
    doc.text(`Jubilado: ${resumen.nombreCompleto}`);
    doc.text(`DPI: ${resumen.dpi || ""}`);
    doc.text(`Tipo de pago: ${resumen.tipoPago}    Estado de pago: ${resumen.estadoPago}`);

    doc.moveDown(0.6).fontSize(12).fillColor("#1F4E79").text("Resumen financiero");
    doc.fillColor("#000").fontSize(10);
    doc.text(`Pensión mensual: ${Q(resumen.pension)}`);
    doc.text(`Total pagado: ${Q(resumen.totalPagado)}`);
    doc.text(`Meses en deuda: ${resumen.periodosDeuda}    Meses de historia: ${resumen.periodosHistoria}`);
    doc.moveDown(0.2).fontSize(12).fillColor(resumen.deudaPendiente > 0 ? "#F44336" : "#4CAF50")
      .text(`SALDO PENDIENTE: ${Q(resumen.deudaPendiente)}`);

    doc.moveDown(0.6).fontSize(12).fillColor("#1F4E79").text("Detalle de deuda / historia");
    doc.fillColor("#000").fontSize(9);
    doc.text("Período | Pensión completa | Pagado | Saldo | Estado | Tipo");
    doc.moveTo(doc.x, doc.y).lineTo(560, doc.y).stroke("#cccccc");
    deudas.forEach((d) => {
      const estado = d.esDeuda ? d.estado : "HISTORIA";
      doc.text(`${perF(d.periodo)} | ${Q(d.pensionCompleta)} | ${Q(d.montoPagado)} | ${Q(d.saldo)} | ${estado} | ${d.tipoPago}`);
    });

    doc.end();
  });
};

module.exports = {
  buscar, noAmparistas, deudaTotal, beneficiariosRegistrados, beneficiariosActivos,
  resumenFinanciero, ultimosPagos, deudaDetalle, historiaCompleta, registrarFallecimiento,
  generarEstadoCuentaPdf
};
