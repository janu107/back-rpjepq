const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const pdf = require("../utils/pdfLayout");
const { numeroALetras } = require("../utils/numeroALetras");

// Reporte de depósitos de una planilla de jubilados (AAAAMM):
//   - Detalle por banco y tipo de jubilación (con "Van / Vienen" entre hojas).
//   - Resumen general: tipo de jubilación x banco, total por banco y total general.
// PDF (carta) y Excel. Firmas desde la pantalla (no se guardan personas).

const createError = (message, status = 400) => { const e = new Error(message); e.status = status; return e; };
const num = (v) => Math.round(Number(v || 0) * 100) / 100;
const MES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const ORDEN_TIPOS = ["RETIRO VOLUNTARIO", "VEJEZ", "VIUDEZ", "ORFANDAD", "INVALIDEZ"];
const NOMBRE_BANCO = { BI: "BANCO INDUSTRIAL", "BANCO INDUSTRIAL": "BANCO INDUSTRIAL", BANRURAL: "BANRURAL", BANTRAB: "BANTRAB", CHEQUE: "PAGO CON CHEQUE" };
const nombreBanco = (b) => (b ? (NOMBRE_BANCO[String(b).toUpperCase()] || String(b).toUpperCase()) : "SIN DATOS DE PAGO");
const ordenBanco = (b) => ({ "BANCO INDUSTRIAL": 0, BANRURAL: 1, BANTRAB: 2, "PAGO CON CHEQUE": 8, "SIN DATOS DE PAGO": 9 }[b] ?? 5);
const ordenTipo = (t) => { const i = ORDEN_TIPOS.indexOf(t); return i < 0 ? (t === "SIN CLASIFICAR" ? 99 : 50) : i; };

const parsearFirmas = (raw) => {
  if (!raw) return [];
  try { const a = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(a) ? a.slice(0, 4) : []; } catch { return []; }
};

const getDepositos = async (idPlanilla, opciones = {}) => {
  const [[planilla]] = await pool.query(
    `SELECT ppl_correlativo AS id, ppl_tipo_planilla AS tipoPlanilla, ppl_numero AS numero, ppl_fecha_inicio AS fechaInicio,
            ppl_fecha_final AS fechaFinal, ppl_fecha_pago AS fechaPago, ppl_estado_proceso AS estado
       FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = ?`, [idPlanilla]
  );
  if (!planilla) throw createError("Planilla no encontrada", 404);
  if (Number(planilla.tipoPlanilla) !== 2) throw createError("El reporte de depósitos es para planillas de jubilados", 409);
  const [rows] = await pool.query(getSql("impresiones/depositosBanco.sql"), [idPlanilla, idPlanilla, idPlanilla]);
  let filas = rows.map((r) => ({ ...r, banco: nombreBanco(r.banco), monto: num(r.monto) }));
  const filtroBanco = String(opciones.banco || "").trim().toUpperCase();
  if (filtroBanco) filas = filas.filter((f) => f.banco === nombreBanco(filtroBanco) || f.banco === filtroBanco);
  const filtroTipo = String(opciones.tipoJubilacion || "").trim().toUpperCase();
  if (filtroTipo) filas = filas.filter((f) => String(f.tipo_jubilacion).toUpperCase() === filtroTipo);

  const bancos = [...new Set(filas.map((f) => f.banco))].sort((a, b) => ordenBanco(a) - ordenBanco(b) || a.localeCompare(b));
  const tipos = [...new Set(filas.map((f) => f.tipo_jubilacion))].sort((a, b) => ordenTipo(a) - ordenTipo(b) || a.localeCompare(b));
  const matriz = tipos.map((t) => {
    const fila = { tipo: t, porBanco: {}, total: 0 };
    bancos.forEach((b) => { fila.porBanco[b] = num(filas.filter((f) => f.tipo_jubilacion === t && f.banco === b).reduce((a, f) => a + f.monto, 0)); });
    fila.total = num(Object.values(fila.porBanco).reduce((a, v) => a + v, 0));
    return fila;
  });
  const totalBanco = Object.fromEntries(bancos.map((b) => [b, num(filas.filter((f) => f.banco === b).reduce((a, f) => a + f.monto, 0))]));
  const total = num(filas.reduce((a, f) => a + f.monto, 0));
  return { planilla, filas, bancos, tipos, matriz, totalBanco, total, filtroBanco: filtroBanco ? nombreBanco(filtroBanco) : null, filtroTipo: filtroTipo || null };
};

const periodoTexto = (p) => { const s = String(p || ""); return s.length === 6 ? `${MES[Number(s.slice(4, 6)) - 1]} ${s.slice(0, 4)}` : s; };

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
const pdfDepositos = async (idPlanilla, opciones = {}, user) => {
  const d = await getDepositos(idPlanilla, opciones);
  if (!d.filas.length) throw createError("La planilla no tiene depósitos para el filtro elegido", 409);
  const seccion = String(opciones.seccion || "todo").toLowerCase();
  const firmas = parsearFirmas(opciones.firmas);
  const doc = pdf.nuevoDoc(pdf.CARTA);
  const ancho = pdf.anchoUtil(doc);
  const x0 = doc.page.margins.left;
  const impreso = `Planilla ${d.planilla.numero} (${periodoTexto(d.planilla.numero)})  ·  Pago ${pdf.fecha(d.planilla.fechaPago)}`;
  const cabecera = (titulo, area) => (doc2) => pdf.encabezado(doc2, { titulo, area, subtitulo: impreso, institucion: pdf.INSTITUCION_CORTA });
  let primera = true;
  const nuevaHoja = (fn) => { if (!primera) doc.addPage(); primera = false; fn(doc); };

  if (seccion === "todo" || seccion === "detalle") {
    const anchos = pdf.repartirAnchos(doc, [5, 7, 50, 20, 18]);
    const cols = [
      { titulo: "#", campo: "n", align: "right", ancho: anchos[0] },
      { titulo: "COD.", campo: "codigo", align: "center", ancho: anchos[1] },
      { titulo: "NOMBRE", campo: "nombre", align: "left", ancho: anchos[2] },
      { titulo: "# DE CTA.", campo: "cuenta", align: "left", ancho: anchos[3] },
      { titulo: "MONTO", campo: "monto", align: "right", ancho: anchos[4] }
    ];
    const alto = 13; const altoDet = 9;
    d.bancos.forEach((banco) => {
      const cab = cabecera("DEPÓSITOS DE LA NÓMINA DE JUBILADOS", banco);
      nuevaHoja(cab);
      const delBanco = d.filas.filter((f) => f.banco === banco);
      const tiposBanco = d.tipos.filter((t) => delBanco.some((f) => f.tipo_jubilacion === t));
      tiposBanco.forEach((tipo) => {
        const filas = delBanco.filter((f) => f.tipo_jubilacion === tipo);
        const totalTipo = num(filas.reduce((a, f) => a + f.monto, 0));
        if (doc.y + 60 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); cab(doc); }
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#1F4E5F").text(`${tipo}  ·  ${filas.length} depósito(s)`, x0);
        doc.fillColor("#000000").moveDown(0.2);
        const encabezadoTabla = () => {
          const y = doc.y;
          doc.save().rect(x0, y, ancho, 15).fill("#1F4E5F").restore();
          let x = x0;
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF");
          cols.forEach((c) => { doc.text(c.titulo, x + 3, y + 4, { width: c.ancho - 6, align: c.align }); x += c.ancho; });
          doc.fillColor("#000000"); doc.y = y + 15;
        };
        const filaSuma = (etq, valor, fondo) => {
          const y = doc.y;
          doc.save().rect(x0, y, ancho, alto).fill(fondo).restore();
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000")
            .text(etq, x0 + cols[0].ancho + cols[1].ancho + 3, y + 3, { width: cols[2].ancho })
            .text(`Q ${pdf.q(valor)}`, x0 + ancho - cols[4].ancho, y + 3, { width: cols[4].ancho - 4, align: "right" });
          doc.y = y + alto;
        };
        encabezadoTabla();
        let acumulado = 0;
        filas.forEach((f, i) => {
          const h = f.detalle ? alto + altoDet - 2 : alto;
          if (doc.y + h + alto + 6 > doc.page.height - doc.page.margins.bottom - 20) {
            filaSuma("Van", acumulado, "#EEF2F6");
            doc.addPage(); cab(doc);
            doc.font("Helvetica-Bold").fontSize(8).fillColor("#1F4E5F").text(`${tipo} (continuación)`, x0).fillColor("#000000");
            encabezadoTabla();
            filaSuma("Vienen", acumulado, "#EEF2F6");
          }
          const y = doc.y;
          if (i % 2 === 1) doc.save().rect(x0, y, ancho, h).fill("#F5F7F9").restore();
          let x = x0;
          doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
          const valores = [String(i + 1), String(f.codigo ?? ""), f.nombre, f.cuenta || (f.banco === "PAGO CON CHEQUE" ? "CHEQUE" : "—"), `Q ${pdf.q(f.monto)}`];
          cols.forEach((c, k) => {
            doc.text(valores[k], x + 3, y + 3, { width: c.ancho - 6, align: c.align, height: alto - 2, lineBreak: false, ellipsis: true });
            x += c.ancho;
          });
          if (f.detalle) {
            doc.font("Helvetica-Oblique").fontSize(6).fillColor("#555555")
              .text(f.detalle, x0 + cols[0].ancho + cols[1].ancho + 3, y + alto - 2, { width: cols[2].ancho + cols[3].ancho - 6, height: altoDet, lineBreak: false, ellipsis: true });
            doc.fillColor("#000000");
          }
          doc.y = y + h;
          acumulado = num(acumulado + f.monto);
        });
        filaSuma(`TOTAL ${tipo}`, totalTipo, "#DDE3EA");
      });
      doc.moveDown(0.4);
      const y = doc.y;
      doc.save().rect(x0, y, ancho, 16).fill("#1F4E5F").restore();
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF")
        .text(`TOTAL ${banco}  (${delBanco.length} depósitos)`, x0 + 6, y + 4, { width: ancho / 2 })
        .text(`Q ${pdf.q(d.totalBanco[banco])}`, x0 + ancho / 2, y + 4, { width: ancho / 2 - 6, align: "right" });
      doc.fillColor("#000000"); doc.y = y + 20;
      doc.font("Helvetica").fontSize(7.5).text(`EL PRESENTE LISTADO ASCIENDE A LA CANTIDAD DE ${numeroALetras(d.totalBanco[banco])}`, x0, doc.y + 2, { width: ancho });
      pdf.bloqueFirmas(doc, firmas);
    });
  }

  if (seccion === "todo" || seccion === "resumen") {
    nuevaHoja(cabecera("RESUMEN DE DEPÓSITOS DE LA NÓMINA DE JUBILADOS", "POR BANCO Y TIPO DE JUBILACIÓN"));
    const nb = d.bancos.length;
    const pesos = [26, ...Array(nb).fill(Math.max(14, 60 / nb)), 18];
    const anchos = pdf.repartirAnchos(doc, pesos);
    const filaTabla = (valores, { negrita = false, fondo = null, colorTexto = "#000000", altoF = 15 } = {}) => {
      const y = doc.y;
      if (fondo) doc.save().rect(x0, y, ancho, altoF).fill(fondo).restore();
      let x = x0;
      doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(colorTexto);
      valores.forEach((v, k) => { doc.text(v, x + 4, y + 4, { width: anchos[k] - 8, align: k === 0 ? "left" : "right", height: altoF - 2, lineBreak: false, ellipsis: true }); x += anchos[k]; });
      doc.save().lineWidth(0.4).strokeColor("#C9D3DD").moveTo(x0, y + altoF).lineTo(x0 + ancho, y + altoF).stroke().restore();
      doc.fillColor("#000000"); doc.y = y + altoF;
    };
    doc.moveDown(0.5);
    filaTabla(["TIPO DE JUBILACIÓN", ...d.bancos, "TOTAL"], { negrita: true, fondo: "#1F4E5F", colorTexto: "#FFFFFF" });
    d.matriz.forEach((m, i) => filaTabla([m.tipo, ...d.bancos.map((b) => (m.porBanco[b] ? `Q ${pdf.q(m.porBanco[b])}` : "—")), `Q ${pdf.q(m.total)}`], { fondo: i % 2 ? "#F5F7F9" : null }));
    filaTabla(["TOTAL", ...d.bancos.map((b) => `Q ${pdf.q(d.totalBanco[b])}`), `Q ${pdf.q(d.total)}`], { negrita: true, fondo: "#DDE3EA" });

    doc.moveDown(1.5);
    const anchoB = Math.min(ancho, 330);
    const xB = x0 + (ancho - anchoB) / 2;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1F4E5F").text("TOTAL A DEPOSITAR POR BANCO", xB, doc.y, { width: anchoB }).fillColor("#000000");
    doc.moveDown(0.3);
    d.bancos.forEach((b) => {
      const y = doc.y;
      doc.font("Helvetica").fontSize(8.5).text(`TOTAL ${b}`, xB, y, { width: anchoB * 0.6 })
        .text(`Q ${pdf.q(d.totalBanco[b])}`, xB + anchoB * 0.6, y, { width: anchoB * 0.4, align: "right" });
      doc.y = y + 14;
    });
    const y = doc.y + 2;
    doc.save().lineWidth(0.8).strokeColor("#000000").moveTo(xB + anchoB * 0.6, y).lineTo(xB + anchoB, y).stroke()
      .moveTo(xB + anchoB * 0.6, y + 17).lineTo(xB + anchoB, y + 17).stroke().moveTo(xB + anchoB * 0.6, y + 19).lineTo(xB + anchoB, y + 19).stroke().restore();
    doc.font("Helvetica-Bold").fontSize(9.5).text("TOTAL GENERAL", xB, y + 4, { width: anchoB * 0.6 })
      .text(`Q ${pdf.q(d.total)}`, xB + anchoB * 0.6, y + 4, { width: anchoB * 0.4, align: "right" });
    doc.y = y + 26;
    doc.font("Helvetica").fontSize(7.5).text(`${d.filas.length} depósitos · ${numeroALetras(d.total)}`, x0, doc.y, { width: ancho, align: "center" });
    pdf.bloqueFirmas(doc, firmas);
  }

  pdf.marcaImpresion(doc);
  logger.info("Reporte de depósitos por banco", { idPlanilla, seccion, banco: d.filtroBanco, usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `${seccion === "resumen" ? "resumen_depositos" : "depositos"}_${d.planilla.numero}.pdf` };
};

// ---------------------------------------------------------------------------
// Excel: hoja "Resumen" y una hoja por banco (por tipo, con subtotales).
// ---------------------------------------------------------------------------
const excelDepositos = async (idPlanilla, opciones = {}) => {
  const ExcelJS = require("exceljs");
  const d = await getDepositos(idPlanilla, opciones);
  if (!d.filas.length) throw createError("La planilla no tiene depósitos para el filtro elegido", 409);
  const firmas = parsearFirmas(opciones.firmas);
  const seccion = String(opciones.seccion || "todo").toLowerCase();
  const MONEDA = '"Q "#,##0.00';
  const OSCURO = "FF1F4E5F"; const CLARO = "FFDDE3EA";
  const wb = new ExcelJS.Workbook();
  wb.creator = "RPJEPQ";

  const titulo = (ws, ncols, sub) => {
    const t = (texto, tam, negrita = true) => {
      const r = ws.addRow([texto]); ws.mergeCells(r.number, 1, r.number, ncols);
      r.getCell(1).font = { bold: negrita, size: tam }; r.getCell(1).alignment = { horizontal: "center" };
    };
    t("REGIMEN DE PENSIONES Y JUBILACIONES", 13);
    t(pdf.INSTITUCION_CORTA, 11);
    t(sub, 11);
    t(`Planilla ${d.planilla.numero} (${periodoTexto(d.planilla.numero)}) · Pago ${pdf.fecha(d.planilla.fechaPago)}`, 9, false);
    ws.addRow([]);
  };
  const pintar = (r, fondo, blanco) => r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fondo } }; c.font = { bold: true, color: { argb: blanco ? "FFFFFFFF" : "FF000000" } }; });
  const ponerFirmas = (ws) => {
    if (!firmas.length) return;
    ws.addRow([]); ws.addRow([]);
    firmas.forEach((f) => {
      ws.addRow([f.rol || ""]).getCell(1).font = { italic: true };
      ws.addRow([f.nombre || ""]).getCell(1).font = { bold: true };
      ws.addRow([f.cargo || ""]);
      ws.addRow([]);
    });
  };

  // Resumen
  if (seccion !== "detalle") {
  const wr = wb.addWorksheet("Resumen", { pageSetup: { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const nc = d.bancos.length + 2;
  wr.getColumn(1).width = 28;
  for (let i = 2; i <= nc; i += 1) wr.getColumn(i).width = 18;
  titulo(wr, nc, "RESUMEN DE DEPÓSITOS POR BANCO Y TIPO DE JUBILACIÓN");
  pintar(wr.addRow(["TIPO DE JUBILACIÓN", ...d.bancos, "TOTAL"]), OSCURO, true);
  d.matriz.forEach((m) => {
    const r = wr.addRow([m.tipo, ...d.bancos.map((b) => m.porBanco[b] || 0), m.total]);
    for (let i = 2; i <= nc; i += 1) r.getCell(i).numFmt = MONEDA;
  });
  const rt = wr.addRow(["TOTAL", ...d.bancos.map((b) => d.totalBanco[b]), d.total]);
  pintar(rt, CLARO); for (let i = 2; i <= nc; i += 1) rt.getCell(i).numFmt = MONEDA;
  wr.addRow([]);
  wr.addRow(["TOTAL A DEPOSITAR POR BANCO"]).getCell(1).font = { bold: true };
  d.bancos.forEach((b) => { const r = wr.addRow([`TOTAL ${b}`, d.totalBanco[b]]); r.getCell(2).numFmt = MONEDA; });
  const rg = wr.addRow(["TOTAL GENERAL", d.total]); rg.font = { bold: true }; rg.getCell(2).numFmt = MONEDA;
  ponerFirmas(wr);
  }

  // Una hoja por banco
  if (seccion !== "resumen") d.bancos.forEach((banco) => {
    const ws = wb.addWorksheet(banco.slice(0, 31), { pageSetup: { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [6, 9, 42, 20, 16, 50].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    titulo(ws, 6, `DEPÓSITOS DE LA NÓMINA DE JUBILADOS — ${banco}`);
    const delBanco = d.filas.filter((f) => f.banco === banco);
    d.tipos.filter((t) => delBanco.some((f) => f.tipo_jubilacion === t)).forEach((tipo) => {
      const filas = delBanco.filter((f) => f.tipo_jubilacion === tipo);
      const rb = ws.addRow([tipo]); ws.mergeCells(rb.number, 1, rb.number, 6); pintar(rb, OSCURO, true);
      pintar(ws.addRow(["#", "COD.", "NOMBRE", "# DE CTA.", "MONTO", "DETALLE"]), "FFF1F4F7");
      filas.forEach((f, i) => {
        const r = ws.addRow([i + 1, f.codigo, f.nombre, f.cuenta || (banco === "PAGO CON CHEQUE" ? "CHEQUE" : ""), f.monto, f.detalle || ""]);
        r.getCell(5).numFmt = MONEDA;
      });
      const rs = ws.addRow(["", "", `TOTAL ${tipo}`, "", num(filas.reduce((a, f) => a + f.monto, 0))]);
      pintar(rs, CLARO); rs.getCell(5).numFmt = MONEDA;
      ws.addRow([]);
    });
    const rtb = ws.addRow(["", "", `TOTAL ${banco} (${delBanco.length} depósitos)`, "", d.totalBanco[banco]]);
    pintar(rtb, OSCURO, true); rtb.getCell(5).numFmt = MONEDA;
    ponerFirmas(ws);
  });

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), filename: `${seccion === "resumen" ? "resumen_depositos" : "depositos"}_${d.planilla.numero}.xlsx` };
};

// Planillas de jubilados para elegir el período (AAAAMM).
const planillas = async () => {
  const [rows] = await pool.query(
    `SELECT ppl_correlativo AS id, ppl_numero AS numero, ppl_estado_proceso AS estado
       FROM RPJ_CAT_PARAMETRO_PLANILLA
      WHERE ppl_tipo_planilla = 2 AND ppl_estado_proceso IN ('GENERADA', 'CERRADA')
      ORDER BY ppl_numero DESC LIMIT 60`
  );
  return rows;
};

// ---------------------------------------------------------------------------
// Oficios al banco: una carta por banco y tipo de jubilación autorizando debitar
// la cuenta del régimen y acreditar a los jubilados (monto del listado de depósitos).
// Los beneficiarios de jubilados fallecidos van en su propio oficio.
// ---------------------------------------------------------------------------
const MES_MIN = MES.map((m) => m.charAt(0) + m.slice(1).toLowerCase());
const BENEFICIARIOS = "BENEFICIARIOS";

// Datos del banco que se proponen; en pantalla se pueden cambiar.
const DATOS_BANCO = {
  BANRURAL: { nombre: "BANCO DE DESARROLLO RURAL, S.A.", agencia: "Agencia Puerto San José", direccion: "Av. 30 de junio", cuenta: "3-114-00103-4" },
  "BANCO INDUSTRIAL": { nombre: "BANCO INDUSTRIAL, S.A.", agencia: "", direccion: "", cuenta: "" },
  BANTRAB: { nombre: "BANCO DE LOS TRABAJADORES", agencia: "", direccion: "", cuenta: "" }
};

const fechaCarta = (v) => {
  const [y, m, d] = String(v || "").slice(0, 10).split("-").map(Number);
  const f = y ? new Date(y, m - 1, d) : new Date();
  return `${String(f.getDate()).padStart(2, "0")} de ${MES[f.getMonth()].toLowerCase()} de ${f.getFullYear()}`;
};

// "1er.50% Febrero 2023" (queda la mitad pendiente), "2do.50% Agosto 2023" (se completa
// un mes atrasado) o "100% Octubre 2026" (el mes de la planilla).
const etiquetaPeriodo = (f, numeroPlanilla) => {
  const p = String(f.periodo_aplicado || "");
  if (p.length !== 6) return null;
  const mes = `${MES_MIN[Number(p.slice(4, 6)) - 1]} ${p.slice(0, 4)}`;
  const pct = Number(f.pct_periodo || 0);
  if (pct === 50) return { orden: `${p}1`, texto: `1er.50% ${mes}` };
  if (pct === 100 && p !== String(numeroPlanilla)) return { orden: `${p}2`, texto: `2do.50% ${mes}` };
  return { orden: `${p}0`, texto: `${pct}% ${mes}` };
};

const datosOficios = async (idPlanilla, opciones = {}) => {
  const d = await getDepositos(idPlanilla, { banco: opciones.banco });
  const { getNominaJubilados } = require("./impresiones.service");
  const nomina = await getNominaJubilados(idPlanilla, {});
  const periodosDe = new Map();
  nomina.filas.forEach((f) => {
    const k = `${Number(f.es_beneficiario) ? 1 : 0}|${f.codigo}`;
    const e = etiquetaPeriodo(f, d.planilla.numero);
    if (!e) return;
    if (!periodosDe.has(k)) periodosDe.set(k, new Map());
    periodosDe.get(k).set(e.orden, e.texto);
  });

  const filtroTipo = String(opciones.tipoJubilacion || "").trim().toUpperCase();
  const grupos = new Map();
  d.filas
    .filter((f) => !["PAGO CON CHEQUE", "SIN DATOS DE PAGO"].includes(f.banco))
    .forEach((f) => {
      const esBen = Boolean(f.detalle);
      const grupo = esBen ? BENEFICIARIOS : f.tipo_jubilacion;
      if (filtroTipo && grupo !== filtroTipo && !(filtroTipo === BENEFICIARIOS && esBen)) return;
      const k = `${f.banco}|${grupo}`;
      if (!grupos.has(k)) grupos.set(k, { banco: f.banco, grupo, monto: 0, depositos: 0, periodos: new Map() });
      const g = grupos.get(k);
      g.monto = num(g.monto + f.monto);
      g.depositos += 1;
      (periodosDe.get(`${esBen ? 1 : 0}|${f.codigo}`) || new Map()).forEach((t, o) => g.periodos.set(o, t));
    });
  const lista = [...grupos.values()]
    .map((g) => ({ ...g, periodos: [...g.periodos.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([, t]) => t) }))
    .sort((x, y) => ordenBanco(x.banco) - ordenBanco(y.banco)
      || (x.grupo === BENEFICIARIOS ? -1 : y.grupo === BENEFICIARIOS ? 1 : ordenTipo(x.grupo) - ordenTipo(y.grupo)));
  return { planilla: d.planilla, oficios: lista };
};

// Vista previa para la pantalla: qué oficios salen, montos y datos del banco propuestos.
const previewOficios = async (idPlanilla, opciones = {}) => {
  const { planilla, oficios } = await datosOficios(idPlanilla, opciones);
  const [firmantes] = await pool.query(
    `SELECT CONCAT(jun_nombre, ' ', jun_apellidos) AS nombre, jun_puesto AS puesto
       FROM RPJ_MNT_JUNTA_DIRECTIVA
      WHERE jun_estado = 'ACTIVO' AND jun_tipo_junta = 'JUNTA ADMINISTRADORA'
        AND jun_puesto IN ('PRESIDENTE', 'TESORERO TITULAR')
      ORDER BY jun_puesto = 'TESORERO TITULAR'`
  );
  const bancos = [...new Set(oficios.map((o) => o.banco))];
  return {
    planilla,
    oficios,
    bancos: Object.fromEntries(bancos.map((b) => [b, DATOS_BANCO[b] || { nombre: b, agencia: "", direccion: "", cuenta: "" }])),
    firmas: firmantes.map((f) => ({ nombre: f.nombre, cargo: f.puesto === "PRESIDENTE" ? "PRESIDENTE" : "TESORERO" }))
  };
};

const parsearJson = (raw, def) => { try { return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : def; } catch { return def; } };

const pdfOficios = async (idPlanilla, opciones = {}, user) => {
  const { planilla, oficios } = await datosOficios(idPlanilla, opciones);
  if (!oficios.length) throw createError("No hay depósitos a cuenta para el filtro elegido", 409);
  const datosBanco = parsearJson(opciones.bancos, {});
  const conceptos = parsearJson(opciones.conceptos, {});
  const firmas = parsearFirmas(opciones.firmas).filter((f) => f && (f.nombre || f.cargo)).slice(0, 3);
  const fechaTxt = fechaCarta(opciones.fecha);

  const doc = pdf.nuevoDoc({ size: "LETTER", layout: "portrait", margins: { top: 72, bottom: 60, left: 92, right: 92 } });
  const x0 = doc.page.margins.left;
  const ancho = pdf.anchoUtil(doc);
  const N = "Helvetica-Oblique";
  const B = "Helvetica-BoldOblique";
  const TAM = 10.5;

  oficios.forEach((o, i) => {
    if (i > 0) doc.addPage();
    const banco = { ...(DATOS_BANCO[o.banco] || { nombre: o.banco }), ...(datosBanco[o.banco] || {}) };
    const periodos = String(conceptos[`${o.banco}|${o.grupo}`] || "").trim() || o.periodos.join(", ") || periodoTexto(planilla.numero);
    const monto = `Q${o.monto.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    doc.y = 150;
    doc.font(N).fontSize(TAM).fillColor("#000000")
      .text("Puerto Quetzal,", x0, doc.y, { width: ancho, align: "center" })
      .text(fechaTxt, { width: ancho, align: "center" });
    doc.moveDown(2.5);
    doc.text("Señores", x0, doc.y);
    doc.font(B).text(banco.nombre || o.banco);
    doc.font(N);
    if (banco.agencia) doc.text(banco.agencia);
    if (banco.direccion) doc.text(banco.direccion);
    doc.text("Presente");
    doc.moveDown(2);
    doc.text("Estimados Señores:");
    doc.moveDown(1);

    const op = { width: ancho, align: "left", continued: true, lineGap: 1.5 };
    const varios = periodos.includes("\n") || o.periodos.length > 1 && !conceptos[`${o.banco}|${o.grupo}`];
    const lineas = varios ? (conceptos[`${o.banco}|${o.grupo}`] ? periodos.split(/\n/) : o.periodos) : [periodos];
    doc.font(N).text(`Por este medio, autorizamos se sirvan debitar el ${fechaTxt}, de la cuenta No. ${banco.cuenta || "______________"} a nombre de Régimen de Pensiones y Jubilaciones del personal de la Empresa Portuaria Quetzal, y se acredite a `, x0, doc.y, op);
    if (o.grupo === BENEFICIARIOS) {
      doc.text("la cuenta correspondiente a los ", op).font(B).text("Beneficiarios", op)
        .font(N).text(" de difuntos Jubilados por concepto de pago de pensiones correspondiente", op);
    } else {
      doc.text("las cuentas correspondientes del personal jubilado por ", op).font(B).text(o.grupo, op)
        .font(N).text(" por concepto de pago de jubilación correspondiente", op);
    }
    // Un periodo: en la misma frase. Varios: uno por renglón, como en el oficio en papel.
    if (varios) {
      doc.text(":", { ...op, continued: false });
      doc.moveDown(0.8);
      lineas.filter((l) => l.trim()).forEach((l) => doc.text(l.trim(), x0, doc.y, { width: ancho }));
      doc.moveDown(0.8);
      doc.text(`Por un monto de: ${numeroALetras(o.monto)} `, x0, doc.y, op);
    } else {
      doc.text(` al ${periodos} por un monto de: ${numeroALetras(o.monto)} `, op);
    }
    doc.font(B).text(`(${monto})`, op)
      .font(N).text(" adjuntando listado respectivo.", { ...op, continued: false });
    doc.moveDown(1);
    doc.text("Agradeciendo la atención a la presente, nos suscribimos.", x0, doc.y, { width: ancho });
    doc.moveDown(1);
    doc.text("Atentamente,");

    // Firmas (hasta 3) en una fila.
    const yF = Math.max(doc.y + 110, 600);
    // Las firmas usan casi todo el ancho de la hoja para que el nombre quepa en un renglón.
    const fx0 = 50;
    const col = (doc.page.width - fx0 * 2) / Math.max(firmas.length, 1);
    firmas.forEach((f, k) => {
      const xc = fx0 + col * k;
      doc.font(B).fontSize(TAM - 0.5).text(String(f.nombre || "").toUpperCase(), xc, yF, { width: col - 8, align: "center" });
      doc.text(String(f.cargo || "").toUpperCase(), xc, doc.y, { width: col - 8, align: "center" });
    });
    doc.font(N).fontSize(TAM).text("c.c. Archivo", x0, yF + 60, { width: ancho });
  });

  logger.info("Oficios al banco", { idPlanilla, oficios: oficios.length, usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `oficios_banco_${planilla.numero}.pdf` };
};

module.exports = { getDepositos, pdfDepositos, excelDepositos, planillas, previewOficios, pdfOficios };
