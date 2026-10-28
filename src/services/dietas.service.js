const adminPagos = require("./adminPagos.service");
const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { toISODate } = require("../utils/date");

// Pago de Dietas (modelo vdi_*). El CRUD básico del encabezado se delega en
// adminPagos; aquí se agregan las operaciones del flujo maestro-detalle:
// pagos del mes, recálculo, detalle de sesiones y cambios de estado del pago.

const sql = (file) => getSql(`dietas/${file}.sql`);
const num = (v) => Number(v || 0);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const PERIODO_RE = /^\d{4}-\d{2}$/;
const TIPOS_DOCUMENTO = ["CHEQUE", "TRANSFERENCIA", "DEPOSITO"];

const assertPeriodo = (periodo) => {
  if (!PERIODO_RE.test(String(periodo || ""))) throw createError("Periodo inválido (use YYYY-MM)");
};

const mapPago = (r) => ({
  id: r.vdi_correlativo,
  idJuntaDirectiva: r.vdi_id_junta_directiva,
  periodo: r.vdi_periodo,
  totalSesiones: num(r.vdi_total_sesiones),
  valor: num(r.vdi_valor),
  isr: num(r.vdi_isr),
  valorPago: num(r.vdi_valor_pago),
  estado: r.vdi_estado,
  noDocumento: r.vdi_no_documento,
  tipoDocumento: r.vdi_tipo_documento,
  banco: r.vdi_banco,
  fechaPago: r.vdi_fecha_pago,
  fechaRecibido: r.vdi_fecha_recibido,
  observaciones: r.vdi_observaciones,
  juntaNombre: `${r.jun_nombre || ""} ${r.jun_apellidos || ""}`.trim(),
  juntaPuesto: r.jun_puesto
});

const pagosDelMes = async (periodo) => {
  assertPeriodo(periodo);
  const [rows] = await pool.execute(sql("pagosDelMes"), [periodo]);
  return rows.map(mapPago);
};

const recalcular = async (periodo) => {
  assertPeriodo(periodo);
  await pool.execute(sql("recalcularMes"), [periodo]);
  logger.info("Dietas recalculadas", { periodo });
  return pagosDelMes(periodo);
};

const detalle = async (id) => {
  const pago = await adminPagos.getById("dietas", id);
  const [rows] = await pool.execute(sql("detalleSesiones"), [id]);
  return {
    pago,
    sesiones: rows.map((r) => ({
      idDetalle: r.die_correlativo,
      valor: num(r.die_valor),
      idSesion: r.ses_correlativo,
      acta: r.ses_acta,
      fechaSesion: toISODate(r.ses_fecha_sesion),
      descripcion: r.ses_descripcion,
      estado: r.ses_estado
    }))
  };
};

const marcarPagado = async (id, payload, currentUser) => {
  const pago = await adminPagos.getById("dietas", id);
  if (pago.estado !== "PENDIENTE") throw createError("Solo se puede emitir el pago cuando está PENDIENTE", 409);
  const tipoDoc = String(payload?.tipoDocumento || "").toUpperCase();
  if (!payload?.noDocumento || !tipoDoc || !payload?.banco || !payload?.fechaPago) {
    throw createError("Para emitir el pago se requiere No. documento, tipo documento, banco y fecha de pago");
  }
  if (!TIPOS_DOCUMENTO.includes(tipoDoc)) throw createError("Tipo de documento no válido");
  // Solo se paga asistencia de sesiones APROBADAS (asistencia congelada).
  const [sinAprobar] = await pool.execute(
    `SELECT s.ses_acta FROM RPJ_MNT_DIETA_DET det
       JOIN RPJ_MNT_SESION s ON s.ses_correlativo = det.die_id_sesion
      WHERE det.die_id_dieta = ? AND s.ses_estado = 'ACTIVA' ORDER BY s.ses_fecha_sesion`,
    [id]
  );
  if (sinAprobar.length) {
    throw createError(`Primero apruebe la(s) sesión(es) ${sinAprobar.map((r) => r.ses_acta).join(", ")} en la pestaña Sesiones`, 409);
  }
  const [res] = await pool.execute(sql("marcarPagado"), [payload.noDocumento, tipoDoc, payload.banco, payload.fechaPago, id]);
  if (res.affectedRows === 0) throw createError("El pago cambió de estado, recargue e intente de nuevo", 409);
  logger.info("Dieta emitida (PAGADO)", { id, usuario: currentUser?.usuario });
  return adminPagos.getById("dietas", id);
};

const marcarRecibido = async (id, payload, currentUser) => {
  const pago = await adminPagos.getById("dietas", id);
  if (pago.estado !== "PAGADO") throw createError("Solo se puede marcar recibido un pago en estado PAGADO", 409);
  if (!payload?.fechaRecibido) throw createError("Se requiere la fecha de recibido");
  const [res] = await pool.execute(sql("marcarRecibido"), [payload.fechaRecibido, id]);
  if (res.affectedRows === 0) throw createError("El pago cambió de estado, recargue e intente de nuevo", 409);
  logger.info("Dieta marcada RECIBIDO", { id, usuario: currentUser?.usuario });
  return adminPagos.getById("dietas", id);
};

// ---------------------------------------------------------------------------
// Cheque-voucher de dieta (hoja carta): arriba el cheque y abajo el voucher con
// la partida de diario.
//   modo "preimpreso": solo los datos, para imprimir sobre el cheque físico
//                      (las etiquetas ya vienen impresas en el papel).
//   modo "completo":   con etiquetas, líneas y marcos (revisión u hoja en blanco).
// Posiciones en puntos (72 = 1 pulgada) desde la esquina superior izquierda.
// Se calibran aquí cuando se tenga el cheque físico; ajusteX/ajusteY mueven todo.
// ---------------------------------------------------------------------------
const CHEQUE = {
  lugar: "PUERTO QUETZAL, ESCUINTLA",
  ajusteX: 0,
  ajusteY: 0,
  alto: 252,                                   // área del cheque: 3.5"
  numero: { x: 430, y: 40 },
  banco: { x: 50, y: 40 },
  fecha: { x: 250, y: 78, ancho: 320 },
  beneficiario: { x: 50, y: 112, ancho: 380 },
  monto: { x: 450, y: 108, ancho: 112 },
  letras: { x: 50, y: 146, ancho: 500 },
  firmas: { y: 215 },
  voucherY: 276                                // inicio del voucher
};

// Cuentas contables de la partida de diario. PENDIENTE: códigos del catálogo
// contable del régimen (se dejan en blanco hasta que contabilidad los confirme).
const CUENTAS_DIETA = {
  gasto: { codigo: "", nombre: "DIETAS JUNTA DIRECTIVA" },
  isr: { codigo: "", nombre: "ISR RETENIDO POR PAGAR" },
  banco: { codigo: "", nombre: "BANCOS" }
};

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

const generarChequePdf = async (id, usuario, modo = "completo") => {
  const L = require("../utils/pdfLayout");
  const { numeroALetras } = require("../utils/numeroALetras");
  const [rows] = await pool.execute(sql("pagoPorId"), [id]);
  if (!rows[0]) throw createError("Pago de dieta no encontrado", 404);
  const p = mapPago(rows[0]);
  if (p.tipoDocumento !== "CHEQUE" || !p.noDocumento) throw createError("Este pago no se emitió con cheque", 409);
  const [ses] = await pool.execute(sql("detalleSesiones"), [id]);

  const completo = modo !== "preimpreso";
  const C = CHEQUE;
  const X = (x) => x + C.ajusteX;
  const Y = (y) => y + C.ajusteY;
  const doc = L.nuevoDoc({ size: "LETTER", margin: 0 });
  const x0 = 36; const ancho = doc.page.width - 72;
  const [anio, mes] = String(p.periodo || "").split("-");
  const mesTexto = mes ? `${MESES[Number(mes) - 1]} ${anio}` : p.periodo;
  const letras = numeroALetras(p.valorPago);
  const nombre = p.juntaNombre.toUpperCase();
  const banco = String(p.banco || "").toUpperCase();
  const etiqueta = (t, x, y) => { if (completo) doc.font("Helvetica").fontSize(8).fillColor("#555555").text(t, X(x), Y(y)); doc.fillColor("#000000"); };

  // ===== Cheque =====
  if (completo) {
    doc.save().lineWidth(0.6).strokeColor("#9AA5B1").dash(3, { space: 3 })
      .roundedRect(x0, 24, ancho, C.alto - 24, 6).stroke().undash().restore();
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000").text(banco, X(C.banco.x), Y(C.banco.y), { width: 300 });
    doc.font("Helvetica-Bold").fontSize(11).text("No.", X(C.numero.x), Y(C.numero.y), { width: 40 });
  }
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000").text(p.noDocumento, X(C.numero.x + 26), Y(C.numero.y), { width: 114, align: "right" });
  doc.font("Helvetica").fontSize(10).text(`${C.lugar}, ${L.fechaLarga(p.fechaPago)}`, X(C.fecha.x), Y(C.fecha.y), { width: C.fecha.ancho, align: "right" });
  etiqueta("PÁGUESE A LA ORDEN DE:", C.beneficiario.x, C.beneficiario.y - 12);
  doc.font("Helvetica-Bold").fontSize(12).text(nombre, X(C.beneficiario.x), Y(C.beneficiario.y), { width: C.beneficiario.ancho });
  if (completo) doc.save().rect(X(C.monto.x - 8), Y(C.monto.y - 8), C.monto.ancho + 16, 26).lineWidth(0.8).stroke("#000000").restore();
  doc.font("Helvetica-Bold").fontSize(13).text(`**${L.q(p.valorPago)}**`, X(C.monto.x), Y(C.monto.y), { width: C.monto.ancho, align: "right" });
  etiqueta("LA SUMA DE:", C.letras.x, C.letras.y - 12);
  doc.font("Helvetica-Bold").fontSize(10).text(`${letras} ***`, X(C.letras.x), Y(C.letras.y), { width: C.letras.ancho });
  if (completo) {
    [[330, "FIRMA AUTORIZADA"], [450, "FIRMA AUTORIZADA"]].forEach(([x, t]) => {
      doc.moveTo(X(x - 50), Y(C.firmas.y)).lineTo(X(x + 60), Y(C.firmas.y)).lineWidth(0.6).stroke("#000000");
      doc.font("Helvetica").fontSize(7).text(t, X(x - 50), Y(C.firmas.y + 3), { width: 110, align: "center" });
    });
    doc.save().lineWidth(0.5).strokeColor("#888888").dash(2, { space: 4 })
      .moveTo(x0, C.alto + 12).lineTo(x0 + ancho, C.alto + 12).stroke().undash().restore();
  }

  // ===== Voucher =====
  let y = Y(C.voucherY);
  const xv = X(x0);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000").text("REGIMEN DE PENSIONES Y JUBILACIONES", xv, y, { width: ancho, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8.5).text("DEL PERSONAL DE LA EMPRESA PORTUARIA QUETZAL", xv, y + 14, { width: ancho, align: "center" });
  doc.font("Helvetica-Bold").fontSize(10).text("VOUCHER — PAGO DE DIETAS", xv, y + 29, { width: ancho, align: "center" });
  y += 50;

  // Datos del pago (recuadro)
  const caja = (yy, alto) => doc.save().rect(xv, yy, ancho, alto).lineWidth(0.6).stroke("#7A8794").restore();
  const dato = (etq, val, x, yy, w) => {
    doc.font("Helvetica").fontSize(7).fillColor("#555555").text(etq, x, yy, { width: w });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000").text(val || "", x, yy + 9, { width: w, lineBreak: false, ellipsis: true });
  };
  const c4 = ancho / 4;
  caja(y, 58);
  dato("CHEQUE No.", p.noDocumento, xv + 6, y + 5, c4 - 10);
  dato("BANCO", banco, xv + c4, y + 5, c4 - 6);
  dato("FECHA", L.fecha(p.fechaPago), xv + c4 * 2, y + 5, c4 - 6);
  dato("VALOR DEL CHEQUE", `Q ${L.q(p.valorPago)}`, xv + c4 * 3, y + 5, c4 - 6);
  dato("A LA ORDEN DE", nombre, xv + 6, y + 30, c4 * 2 - 10);
  dato("PUESTO", String(p.juntaPuesto || "").toUpperCase(), xv + c4 * 2, y + 30, c4 * 2 - 6);
  y += 66;

  // Concepto
  const sesionesTxt = ses.map((s) => `${s.ses_acta} (${L.fecha(s.ses_fecha_sesion)})`).join(", ");
  doc.font("Helvetica-Bold").fontSize(8).text("CONCEPTO:", xv, y);
  doc.font("Helvetica").fontSize(8.5).text(
    `PAGO DE DIETAS A ${nombre}, ${String(p.juntaPuesto || "").toUpperCase()}, POR ASISTENCIA A ${p.totalSesiones} SESION(ES) DE JUNTA DIRECTIVA DEL MES DE ${mesTexto}${sesionesTxt ? `: ${sesionesTxt}` : ""}. VALOR Q ${L.q(p.valor)}, ISR RETENIDO Q ${L.q(p.isr)}, LÍQUIDO Q ${L.q(p.valorPago)}.`,
    xv + 58, y, { width: ancho - 58 }
  );
  y = doc.y + 10;

  // Partida de diario
  doc.font("Helvetica-Bold").fontSize(9).text("PARTIDA DE DIARIO", xv, y);
  doc.font("Helvetica").fontSize(8).text("No. ____________", xv, y, { width: ancho, align: "right" });
  y += 14;
  const anchos = L.repartirAnchos({ page: { width: ancho + 72, margins: { left: 36, right: 36 } } }, [16, 48, 18, 18]);
  const partida = [
    { cuenta: CUENTAS_DIETA.gasto.codigo, descripcion: CUENTAS_DIETA.gasto.nombre, debe: p.valor, haber: null },
    { cuenta: CUENTAS_DIETA.isr.codigo, descripcion: CUENTAS_DIETA.isr.nombre, debe: null, haber: p.isr },
    { cuenta: CUENTAS_DIETA.banco.codigo, descripcion: `${CUENTAS_DIETA.banco.nombre} — ${banco}`, debe: null, haber: p.valorPago }
  ].filter((f) => Number(f.debe || f.haber || 0) > 0);
  const columnas = [
    { titulo: "CUENTA", campo: "cuenta", align: "left", ancho: anchos[0] },
    { titulo: "DESCRIPCIÓN", campo: "descripcion", align: "left", ancho: anchos[1] },
    { titulo: "DEBE", campo: "debe", align: "right", ancho: anchos[2], valor: (f) => (f.debe ? L.q(f.debe) : "") },
    { titulo: "HABER", campo: "haber", align: "right", ancho: anchos[3], valor: (f) => (f.haber ? L.q(f.haber) : "") }
  ];
  doc.page.margins.left = xv; doc.page.margins.right = 36; doc.page.margins.bottom = 30;
  doc.y = y; doc.x = xv;
  L.dibujarTabla(doc, columnas, partida, { fuente: 8.5, alturaFila: 16, altoEncabezado: 16 });
  const sumaDebe = partida.reduce((a, f) => a + Number(f.debe || 0), 0);
  const sumaHaber = partida.reduce((a, f) => a + Number(f.haber || 0), 0);
  L.filaTotales(doc, columnas, { debe: L.q(sumaDebe), haber: L.q(sumaHaber) }, "SUMAS IGUALES", 2, { fuente: 8.5 });

  // Firmas
  const yF = Math.max(doc.y + 70, Y(660));
  const firmas = ["HECHO POR", "REVISADO POR", "AUTORIZADO POR", "RECIBÍ CONFORME"];
  const wF = ancho / firmas.length;
  firmas.forEach((t, i) => {
    const xf = xv + wF * i;
    doc.moveTo(xf + 12, yF).lineTo(xf + wF - 12, yF).lineWidth(0.6).stroke("#000000");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#000000").text(t, xf, yF + 4, { width: wF, align: "center" });
  });
  doc.font("Helvetica").fontSize(7).text(nombre, xv + wF * 3, yF + 13, { width: wF, align: "center" });
  doc.font("Helvetica").fontSize(7).text("DPI: ____________________", xv + wF * 3, yF + 31, { width: wF, align: "center" });
  doc.font("Helvetica").fontSize(6).fillColor("#666666")
    .text(`Generado por ${usuario || "sistema"} el ${L.fecha(new Date())}`, x0, doc.page.height - 24, { width: ancho, align: "right" });

  logger.info("Cheque de dieta impreso", { id, cheque: p.noDocumento, modo, usuario });
  return { buffer: await L.aBuffer(doc), filename: `cheque_${p.noDocumento}.pdf` };
};

module.exports = {
  generarChequePdf,
  list: () => adminPagos.list("dietas"),
  getById: (id) => adminPagos.getById("dietas", id),
  create: (payload, user) => adminPagos.create("dietas", payload, user),
  update: (id, payload, user) => adminPagos.update("dietas", id, payload, user),
  remove: (id, user) => adminPagos.remove("dietas", id, user),
  pagosDelMes,
  recalcular,
  detalle,
  marcarPagado,
  marcarRecibido
};
