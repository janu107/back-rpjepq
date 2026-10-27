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
      (SELECT COALESCE(SUM(deu_monto_pendiente),0) FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_estado IN ('PENDIENTE','PARCIAL')) AS deudaTotal
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

// Búsqueda por código, nombres, apellidos o DPI. Cada palabra debe aparecer en
// alguno de esos campos ("garcia valdez" encuentra a RAFAEL ESTUARDO GARCIA VALDEZ).
// alias: tabla de jubilados; aliasBen (opcional): tabla de beneficiarios.
const condBusqueda = (q, alias = "j", aliasBen = null) => {
  const palabras = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const cond = []; const params = [];
  palabras.forEach((w) => {
    const like = `%${w}%`;
    const partes = [`${alias}.jub_nombres LIKE ?`, `${alias}.jub_apellidos LIKE ?`, `${alias}.jub_dpi LIKE ?`];
    const p = [like, like, like];
    if (/^\d+$/.test(w)) { partes.push(`${alias}.jub_id = ?`); p.push(Number(w)); }
    if (aliasBen) {
      partes.push(`${aliasBen}.ben_nombres LIKE ?`, `${aliasBen}.ben_apellidos LIKE ?`, `${aliasBen}.ben_dpi LIKE ?`);
      p.push(like, like, like);
    }
    cond.push(`(${partes.join(" OR ")})`); params.push(...p);
  });
  return { cond, params };
};

const saldos = async (q) => {
  const busq = condBusqueda(q, "j");
  const [rows] = await pool.query(`
    SELECT j.jub_correlativo AS idJubilado, j.jub_id AS codigo, CONCAT(j.jub_nombres,' ',j.jub_apellidos) AS nombre, j.jub_dpi AS dpi,
           j.jub_tipo_pago AS tipoPago, j.jub_estado_pago AS estadoPago,
           COALESCE(SUM(CASE WHEN d.deu_estado IN ('PENDIENTE','PARCIAL') THEN d.deu_monto_pendiente ELSE 0 END),0) AS saldo,
           COALESCE(SUM(CASE WHEN d.deu_estado IN ('PENDIENTE','PARCIAL') THEN 1 ELSE 0 END),0) AS mesesAdeudados
      FROM RPJ_MNT_JUBILADO j
      LEFT JOIN RPJ_PRC_DEUDA_JUBILADO d ON d.deu_id_jubilado=j.jub_correlativo
     WHERE j.jub_tipo_manejo=2 ${busq.cond.length ? `AND ${busq.cond.join(" AND ")}` : ""}
     GROUP BY j.jub_correlativo HAVING saldo > 0 ORDER BY saldo DESC`, busq.params);
  return rows.map((r) => ({ ...r, saldo: toNum(r.saldo), mesesAdeudados: toNum(r.mesesAdeudados) }));
};

const pagos = async (desde, hasta, idJubilado, q) => {
  const cond = ["i.nin_tipo_manejo=2", "p.ppl_estado_proceso <> 'REVERSADA'"];
  const params = [];
  if (idJubilado) { cond.push("i.nin_id_jubilado = ?"); params.push(Number(idJubilado)); }
  const busq = condBusqueda(q, "j", "b");
  cond.push(...busq.cond); params.push(...busq.params);
  if (desde) { cond.push("p.ppl_fecha_pago >= ?"); params.push(desde); }
  if (hasta) { cond.push("p.ppl_fecha_pago <= ?"); params.push(hasta); }
  const [rows] = await pool.query(`
    SELECT i.nin_correlativo AS id, p.ppl_numero AS periodo, p.ppl_fecha_pago AS fechaPago,
           i.nin_id_tipo_planilla AS tipoPlanilla, i.nin_id_jubilado AS idJubilado, i.nin_id_beneficiario AS idBeneficiario,
           j.jub_id AS codigo,
           COALESCE(CONCAT(j.jub_nombres,' ',j.jub_apellidos), CONCAT(b.ben_nombres,' ',b.ben_apellidos)) AS beneficiario,
           i.nin_valor AS total, i.nin_pago_corriente AS pagoCorriente, i.nin_abono_historico AS abono,
           i.nin_porcentaje_aplicado AS porcentaje
      FROM RPJ_PRC_NOMINA_INGRESO i
      LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo=i.nin_id_planilla
      LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo=i.nin_id_jubilado
      LEFT JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_correlativo=i.nin_id_beneficiario
     WHERE ${cond.join(" AND ")}
     ORDER BY p.ppl_fecha_pago DESC, i.nin_correlativo DESC LIMIT ${idJubilado || busq.cond.length ? 2000 : 500}`, params);
  return rows.map((r) => ({ ...r, total: toNum(r.total), pagoCorriente: toNum(r.pagoCorriente), abono: toNum(r.abono), porcentaje: toNum(r.porcentaje) }));
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
           SUM(CASE WHEN deu_estado IN ('PENDIENTE','PARCIAL') THEN 1 ELSE 0 END) AS periodosDeuda,
           COALESCE(SUM(CASE WHEN deu_estado IN ('PENDIENTE','PARCIAL') THEN deu_monto_pendiente ELSE 0 END),0) AS saldo
      FROM RPJ_PRC_DEUDA_JUBILADO GROUP BY deu_tipo_pago`);
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

// ---------------------------------------------------------------------------
// PDF formal de cada reporte (mismo estilo que las impresiones del sistema):
// encabezado institucional, título, filtros aplicados, tabla, totales y pie.
// ---------------------------------------------------------------------------
const REPORTES_PDF = {
  saldos: {
    titulo: "Reporte de saldos de jubilados",
    datos: (f) => saldos(f.q),
    columnas: [
      { titulo: "CÓDIGO", campo: "codigo", peso: 6, align: "right" },
      { titulo: "JUBILADO", campo: "nombre", peso: 30 },
      { titulo: "DPI", campo: "dpi", peso: 14 },
      { titulo: "TIPO", campo: "tipoPago", peso: 10 },
      { titulo: "ESTADO", campo: "estadoPago", peso: 10 },
      { titulo: "MESES ADEUDADOS", campo: "mesesAdeudados", peso: 9, align: "right", total: "suma0" },
      { titulo: "SALDO", campo: "saldo", peso: 12, align: "right", monto: true, total: "suma" }
    ]
  },
  pagos: {
    titulo: "Reporte de pagos a jubilados",
    datos: (f) => pagos(f.desde, f.hasta, f.idJubilado, f.q),
    horizontal: true,
    columnas: [
      { titulo: "PERÍODO", campo: "periodo", peso: 7 },
      { titulo: "FECHA PAGO", campo: "fechaPago", peso: 9, fecha: true, align: "center" },
      { titulo: "CÓDIGO", campo: "codigo", peso: 6, align: "right" },
      { titulo: "BENEFICIARIO / JUBILADO", campo: "beneficiario", peso: 30 },
      { titulo: "% PAGADO", campo: "porcentaje", peso: 7, align: "right", pct: true },
      { titulo: "PAGO DEL MES", campo: "pagoCorriente", peso: 11, align: "right", monto: true, total: "suma" },
      { titulo: "ABONO A DEUDA", campo: "abono", peso: 11, align: "right", monto: true, total: "suma" },
      { titulo: "TOTAL", campo: "total", peso: 11, align: "right", monto: true, total: "suma" }
    ]
  },
  "beneficiarios-activos": {
    titulo: "Reporte de beneficiarios activos",
    datos: () => beneficiariosActivos(),
    columnas: [
      { titulo: "BENEFICIARIO", campo: "nombre", peso: 28 },
      { titulo: "DPI", campo: "dpi", peso: 14 },
      { titulo: "PARENTESCO", campo: "parentesco", peso: 12 },
      { titulo: "%", campo: "porcentaje", peso: 7, align: "right", pct: true },
      { titulo: "JUBILADO", campo: "jubilado", peso: 28 }
    ]
  },
  convenios: {
    titulo: "Reporte de convenios de pago",
    datos: () => convenios(),
    columnas: [
      { titulo: "TITULAR", campo: "titular", peso: 30 },
      { titulo: "TIPO", campo: "tipo", peso: 12 },
      { titulo: "ESTADO", campo: "estado", peso: 10 },
      { titulo: "DEUDA", campo: "deudaTotal", peso: 13, align: "right", monto: true, total: "suma" },
      { titulo: "CUOTA", campo: "montoCuota", peso: 12, align: "right", monto: true },
      { titulo: "CUOTAS", campo: "cuotas", peso: 7, align: "right" }
    ]
  },
  "deuda-por-tipo": {
    titulo: "Reporte de deuda por tipo de pago",
    datos: () => deudaPorTipo(),
    columnas: [
      { titulo: "TIPO DE PAGO", campo: "tipoPago", peso: 30 },
      { titulo: "PERÍODOS", campo: "periodosDeuda", peso: 15, align: "right", total: "suma0" },
      { titulo: "SALDO", campo: "saldo", peso: 20, align: "right", monto: true, total: "suma" }
    ]
  },
  amparistas: {
    titulo: "Reporte de amparistas",
    datos: () => amparistas(),
    columnas: [
      { titulo: "JUBILADO", campo: "nombre", peso: 28 },
      { titulo: "DPI", campo: "dpi", peso: 14 },
      { titulo: "ESTADO", campo: "estadoPago", peso: 10 },
      { titulo: "EXPEDIENTE", campo: "noExpediente", peso: 13 },
      { titulo: "JUZGADO", campo: "juzgado", peso: 22 },
      { titulo: "F. EFECTIVA", campo: "fechaEfectiva", peso: 10, fecha: true, align: "center" }
    ]
  }
};

const pdfReporte = async (nombre, filtros = {}, usuario) => {
  const def = REPORTES_PDF[nombre];
  if (!def) { const e = new Error("Reporte no encontrado"); e.status = 404; throw e; }
  const L = require("../utils/pdfLayout");
  const filas = await def.datos(filtros);

  const doc = L.nuevoDoc(def.horizontal ? { size: "LETTER", layout: "landscape", margin: 30 } : L.CARTA);
  const anchos = L.repartirAnchos(doc, def.columnas.map((c) => c.peso));
  const valor = (c, f) => {
    const v = f[c.campo];
    if (c.monto) return L.q(v);
    if (c.pct) return `${Number(v || 0)}%`;
    if (c.fecha) return v ? L.fecha(v) : "";
    return v ?? "";
  };
  const columnas = def.columnas.map((c, i) => ({ titulo: c.titulo, campo: c.campo, align: c.align || "left", ancho: anchos[i], valor: (f) => valor(c, f) }));

  const aplicados = [
    filtros.q ? `Búsqueda: "${String(filtros.q).trim()}"` : null,
    filtros.desde || filtros.hasta ? `Fecha de pago: ${filtros.desde ? L.fecha(filtros.desde) : "inicio"} al ${filtros.hasta ? L.fecha(filtros.hasta) : "hoy"}` : null
  ].filter(Boolean);
  const cabecera = (d) => L.encabezado(d, {
    titulo: def.titulo,
    subtitulo: `Generado el ${L.fechaLarga()}  ·  ${filas.length} registro(s)`,
    lineas: aplicados.length ? [`Filtros: ${aplicados.join("   ·   ")}`] : []
  });
  cabecera(doc);

  if (!filas.length) {
    doc.font("Helvetica").fontSize(9).text("No hay registros con los filtros aplicados.", { align: "center" });
  } else {
    L.dibujarTabla(doc, columnas, filas, { fuente: 7, alturaFila: 12, altoEncabezado: 18, reservaInferior: 20, alRepetirEncabezado: cabecera });
    const conTotal = def.columnas.filter((c) => c.total);
    if (conTotal.length) {
      const totales = {};
      conTotal.forEach((c) => {
        const suma = filas.reduce((s, f) => s + Number(f[c.campo] || 0), 0);
        totales[c.campo] = c.total === "suma0" ? String(suma) : L.q(suma);
      });
      const primeraConTotal = def.columnas.findIndex((c) => c.total);
      L.filaTotales(doc, columnas, totales, "TOTALES", Math.max(1, primeraConTotal));
    }
  }
  L.pieDePagina(doc, usuario);
  return { buffer: await L.aBuffer(doc), filename: `${nombre}.pdf` };
};

module.exports = { dashboardResumen, saldos, pagos, beneficiariosActivos, convenios, deudaPorTipo, amparistas, pdfReporte, REPORTES_PDF };
