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
// Cheque de dieta (carta vertical): arriba el cheque y abajo el comprobante.
// FORMATO PROVISIONAL: cuando se tenga el cheque del banco se ajustan las
// posiciones en CHEQUE (puntos; 72 = 1 pulgada) y se quita el marco guía.
// ---------------------------------------------------------------------------
const CHEQUE = {
  lugar: "PUERTO QUETZAL, ESCUINTLA",
  marcoGuia: true,           // contorno del cheque (no imprimir sobre cheque preimpreso)
  alto: 252,                 // 3.5"
  numero: { x: 430, y: 40 },
  banco: { x: 50, y: 40 },
  fecha: { x: 250, y: 78 },
  monto: { x: 450, y: 108 },
  beneficiario: { x: 50, y: 112, ancho: 380 },
  letras: { x: 50, y: 146, ancho: 500 },
  firmas: { y: 215 }
};
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

const generarChequePdf = async (id, usuario) => {
  const L = require("../utils/pdfLayout");
  const { numeroALetras } = require("../utils/numeroALetras");
  const [rows] = await pool.execute(sql("pagoPorId"), [id]);
  if (!rows[0]) throw createError("Pago de dieta no encontrado", 404);
  const p = mapPago(rows[0]);
  if (p.tipoDocumento !== "CHEQUE" || !p.noDocumento) throw createError("Este pago no se emitió con cheque", 409);
  const [ses] = await pool.execute(sql("detalleSesiones"), [id]);

  const doc = L.nuevoDoc({ size: "LETTER", margin: 0 });
  const x0 = 36; const ancho = doc.page.width - 72;
  const [anio, mes] = String(p.periodo || "").split("-");
  const mesTexto = mes ? `${MESES[Number(mes) - 1]} ${anio}` : p.periodo;
  const letras = numeroALetras(p.valorPago);

  // --- Cheque ---
  const C = CHEQUE;
  if (C.marcoGuia) {
    doc.save().lineWidth(0.6).strokeColor("#9AA5B1").dash(3, { space: 3 })
      .roundedRect(x0, 24, ancho, C.alto - 24, 6).stroke().undash().restore();
    doc.font("Helvetica-Oblique").fontSize(6).fillColor("#9AA5B1")
      .text("FORMATO PROVISIONAL — guía del área del cheque", x0 + 8, 28);
  }
  doc.fillColor("#000000");
  doc.font("Helvetica-Bold").fontSize(10).text(String(p.banco || "").toUpperCase(), C.banco.x, C.banco.y, { width: 300 });
  doc.font("Helvetica-Bold").fontSize(11).text(`No. ${p.noDocumento}`, C.numero.x, C.numero.y, { width: 140, align: "right" });
  doc.font("Helvetica").fontSize(10).text(`${C.lugar}, ${L.fechaLarga(p.fechaPago)}`, C.fecha.x, C.fecha.y, { width: 320, align: "right" });
  doc.font("Helvetica").fontSize(9).text("PÁGUESE A LA ORDEN DE:", C.beneficiario.x, C.beneficiario.y - 12);
  doc.font("Helvetica-Bold").fontSize(12).text(p.juntaNombre.toUpperCase(), C.beneficiario.x, C.beneficiario.y, { width: C.beneficiario.ancho });
  doc.save().rect(C.monto.x - 8, C.monto.y - 8, 128, 26).lineWidth(0.8).stroke("#000000").restore();
  doc.font("Helvetica-Bold").fontSize(13).text(`Q ${L.q(p.valorPago)}`, C.monto.x, C.monto.y, { width: 112, align: "right" });
  doc.font("Helvetica").fontSize(9).text("LA SUMA DE:", C.letras.x, C.letras.y - 12);
  doc.font("Helvetica-Bold").fontSize(10).text(`${letras} ***`, C.letras.x, C.letras.y, { width: C.letras.ancho });
  [[330, "FIRMA AUTORIZADA"], [450, "FIRMA AUTORIZADA"]].forEach(([x, t]) => {
    doc.moveTo(x - 50, C.firmas.y).lineTo(x + 60, C.firmas.y).lineWidth(0.6).stroke("#000000");
    doc.font("Helvetica").fontSize(7).text(t, x - 50, C.firmas.y + 3, { width: 110, align: "center" });
  });

  // --- Línea de corte ---
  const yCorte = C.alto + 12;
  doc.save().lineWidth(0.5).strokeColor("#888888").dash(2, { space: 4 }).moveTo(x0, yCorte).lineTo(x0 + ancho, yCorte).stroke().undash().restore();

  // --- Comprobante ---
  let y = yCorte + 18;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000").text("REGIMEN DE PENSIONES Y JUBILACIONES", x0, y, { width: ancho, align: "center" });
  doc.font("Helvetica-Bold").fontSize(9).text("DEL PERSONAL DE LA EMPRESA PORTUARIA QUETZAL", x0, y + 14, { width: ancho, align: "center" });
  doc.font("Helvetica-Bold").fontSize(10).text("COMPROBANTE DE PAGO DE DIETAS", x0, y + 30, { width: ancho, align: "center" });
  y += 54;
  const dato = (etq, val, x, yy, w) => {
    doc.font("Helvetica").fontSize(8).fillColor("#555555").text(etq, x, yy, { width: w });
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000").text(val || "", x, yy + 10, { width: w });
  };
  const col = ancho / 4;
  dato("BENEFICIARIO", p.juntaNombre.toUpperCase(), x0, y, col * 2 - 8);
  dato("PUESTO", String(p.juntaPuesto || "").toUpperCase(), x0 + col * 2, y, col * 2);
  y += 30;
  dato("CHEQUE No.", p.noDocumento, x0, y, col - 8);
  dato("BANCO", String(p.banco || "").toUpperCase(), x0 + col, y, col - 8);
  dato("FECHA DE PAGO", L.fecha(p.fechaPago), x0 + col * 2, y, col - 8);
  dato("PERIODO", mesTexto, x0 + col * 3, y, col);
  y += 32;
  doc.font("Helvetica").fontSize(9).text(`CONCEPTO: PAGO DE DIETAS POR ASISTENCIA A ${p.totalSesiones} SESION(ES) DE JUNTA DIRECTIVA, ${mesTexto}.`, x0, y, { width: ancho });
  y = doc.y + 8;

  const anchos = L.repartirAnchos({ page: { width: ancho + 72, margins: { left: 36, right: 36 } } }, [16, 18, 46, 20]);
  const columnas = [
    { titulo: "ACTA", campo: "ses_acta", align: "left", ancho: anchos[0] },
    { titulo: "FECHA", campo: "ses_fecha_sesion", align: "center", ancho: anchos[1], valor: (f) => L.fecha(f.ses_fecha_sesion) },
    { titulo: "DESCRIPCIÓN", campo: "ses_descripcion", align: "left", ancho: anchos[2] },
    { titulo: "VALOR", campo: "die_valor", align: "right", ancho: anchos[3], valor: (f) => L.q(f.die_valor) }
  ];
  doc.page.margins.left = x0; doc.page.margins.right = x0; doc.page.margins.bottom = 36;
  doc.y = y; doc.x = x0;
  L.dibujarTabla(doc, columnas, ses, { fuente: 8, alturaFila: 13, altoEncabezado: 16 });
  const totalCol = (etq, val, negrita) => {
    const yy = doc.y + 3;
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#000000")
      .text(etq, x0 + anchos[0] + anchos[1], yy, { width: anchos[2] - 4, align: "right" })
      .text(val, x0 + anchos[0] + anchos[1] + anchos[2], yy, { width: anchos[3] - 2, align: "right" });
    doc.y = yy + 13;
  };
  totalCol("VALOR TOTAL", `Q ${L.q(p.valor)}`);
  totalCol("(-) ISR", `Q ${L.q(p.isr)}`);
  totalCol("LÍQUIDO A RECIBIR", `Q ${L.q(p.valorPago)}`, true);
  doc.font("Helvetica").fontSize(8).text(`(${letras})`, x0, doc.y + 4, { width: ancho, align: "right" });

  // Firmas del comprobante
  const yF = Math.max(doc.y + 60, 640);
  const firmas = ["ELABORADO POR", "REVISADO POR", "AUTORIZADO POR", "RECIBÍ CONFORME"];
  const wF = ancho / firmas.length;
  firmas.forEach((t, i) => {
    const xf = x0 + wF * i;
    doc.moveTo(xf + 12, yF).lineTo(xf + wF - 12, yF).lineWidth(0.6).stroke("#000000");
    doc.font("Helvetica-Bold").fontSize(7).text(t, xf, yF + 4, { width: wF, align: "center" });
  });
  doc.font("Helvetica").fontSize(7).text(`Nombre: ${p.juntaNombre.toUpperCase()}`, x0 + wF * 3, yF + 14, { width: wF, align: "center" });
  doc.font("Helvetica").fontSize(6).fillColor("#666666")
    .text(`Generado por ${usuario || "sistema"} el ${L.fecha(new Date())}`, x0, doc.page.height - 30, { width: ancho, align: "right" });

  logger.info("Cheque de dieta impreso", { id, cheque: p.noDocumento, usuario });
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
