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
  juntaPuesto: r.jun_puesto,
  tipoJunta: r.jun_tipo_junta || null
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

// ---------------------------------------------------------------------------
// Cheque-voucher por banco. Cada banco tiene su forma física con medidas propias
// (tomadas de fotos con regla, 2026-10-29), en puntos (72 = 1") desde la esquina
// superior izquierda de la forma. ajusteX / ajusteY mueven todo si la impresora
// corre la hoja. El número de cheque viene preimpreso en la forma; solo se
// imprime en el concepto del voucher. Banco sin formato -> formato general.
// ---------------------------------------------------------------------------
const FORMATOS_CHEQUE = {
  BI: {
    nombre: "BANCO INDUSTRIAL, S. A.", cuentaBanco: "BANCO INDUSTRIAL CTA. 018-502333-8",
    lugar: "PUERTO QUETZAL", ajusteX: 0, ajusteY: 0,
    ancho: 533, altoCheque: 220, altoVoucher: 610,
    fecha: { x: 103, y: 65, ancho: 290 },
    monto: { derecha: 492, y: 65 },
    beneficiario: { x: 105, y: 91, ancho: 380 },
    letras: { x: 109, y: 111, ancho: 400 },
    noNegociable: null,
    vNombre: { centro: 300, y: 226, ancho: 280 },
    vDescripcion: { x: 109, y: 248, ancho: 370 },
    columnas: { cuenta: 0, concepto: 75, debe: 353, haber: 437, fin: 533 },
    encabezadoTabla: { y: 280, alto: 12 },
    vChequeNo: { y: 301, alinear: "center" },
    partida: { x: 112, y: 326, paso: 11, fuente: 7.5 },
    totales: { y: 362 },
    recibido: { x: 113, y: [401, 429, 457], hasta: 418 },
    vFecha: { derecha: 528, y: 530 },
    pie: ["NOMBRE", "REVISADO", "AUTORIZADO", "RECIBI CONFORME"]
  },
  BANRURAL: {
    nombre: "BANRURAL", cuentaBanco: "BANCO BANRURAL CTA. 3-114-00103-4",
    lugar: "PUERTO QUETZAL", ajusteX: 0, ajusteY: 0,
    ancho: 550, altoCheque: 230, altoVoucher: 624,
    fecha: { x: 115, y: 65, ancho: 300 },
    monto: { derecha: 540, y: 73 },
    beneficiario: { x: 115, y: 92, ancho: 400 },
    letras: { x: 116, y: 110, ancho: 358 },
    noNegociable: { x: 115, y: 122 },
    vNombre: { centro: 329, y: 235, ancho: 300 },
    vDescripcion: { x: 115, y: 248, ancho: 425 },
    columnas: { cuenta: 0, concepto: 81, debe: 361, haber: 449, fin: 536 },
    encabezadoTabla: { y: 286, alto: 11 },
    vChequeNo: { y: 303, alinear: "right", derecha: 352 },
    partida: { x: 115, y: 336, paso: 16, fuente: 8.5 },
    totales: { y: 373 },
    recibido: { x: 115, y: [402, 438, 471], hasta: 388 },
    vFecha: { derecha: 534, y: 567 },
    pie: ["HECHO POR", "REVISADO", "AUTORIZADO", "RECIBI CONFORME"]
  }
};
const formatoCheque = (banco) => {
  const b = String(banco || "").trim().toUpperCase();
  if (b === "BI" || b === "BANCO INDUSTRIAL") return FORMATOS_CHEQUE.BI;
  if (b === "BANRURAL") return FORMATOS_CHEQUE.BANRURAL;
  return null;
};

const MESES_BI = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
// "SETECIENTOS CINCUENTA QUETZALES CON 00/100" -> "Setecientos Cincuenta Quetzales Exactos"
// "... QUETZALES CON 84/100" -> "... Quetzales con 84/100"
const letrasCheque = (texto) => {
  const t = String(texto).replace(/ CON 00\/100$/, " EXACTOS");
  return t.toLowerCase().split(" ").map((w) => (w === "con" || w === "y" ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
};

const dibujarChequeBanco = (doc, d, completo, L, C) => {
  const X = (x) => x + C.ajusteX;
  const Y = (y) => y + C.ajusteY;
  const negro = () => doc.fillColor("#000000");
  const f = d.fechaPago ? new Date(d.fechaPago) : new Date();
  const dia = String(f.getDate()).padStart(2, "0");
  const fechaLarga = `${C.lugar}, ${dia} DE ${MESES_BI[f.getMonth()]} DE ${f.getFullYear()}`;
  const fechaCorta = `${f.getDate()}/${f.getMonth() + 1}/${f.getFullYear()}`;
  const col = C.columnas;
  const fondoTabla = C.altoVoucher - 30;

  if (completo) {
    // Guía de la forma (solo para revisar en hoja blanca).
    doc.save().lineWidth(0.6).strokeColor("#9AA5B1").dash(3, { space: 3 })
      .rect(X(0), Y(0), C.ancho, C.altoCheque).stroke()
      .rect(X(0), Y(C.altoCheque + 2), C.ancho, C.altoVoucher - C.altoCheque - 2).stroke().undash().restore();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1F4E79").text(C.nombre, X(10), Y(12));
    doc.font("Helvetica").fontSize(7).fillColor("#555555")
      .text("REGIMEN DE PENSIONES Y JUBILACIONES DEL PERSONAL DE LA E.P.Q.", X(200), Y(12), { width: 280, align: "center" })
      .text("CHEQUE No. (preimpreso)", X(C.ancho - 130), Y(26), { width: 120, align: "right" })
      .text("LUGAR Y FECHA", X(8), Y(C.fecha.y + 1))
      .text("PAGO A LA ORDEN DE", X(8), Y(C.beneficiario.y + 1))
      .text("SUMA DE QUETZALES", X(8), Y(C.letras.y + 1))
      .text("Q.", X(C.monto.derecha - 90), Y(C.monto.y + 1))
      .text("FIRMA", X(300), Y(C.altoCheque - 70)).text("FIRMA", X(430), Y(C.altoCheque - 70))
      .text("DESCRIPCION DEL PAGO", X(8), Y(C.altoCheque + 8));
    [[C.fecha, C.fecha.x + C.fecha.ancho + 10], [C.beneficiario, C.ancho - 12], [C.letras, C.ancho - 12]].forEach(([c, x2]) => {
      doc.save().lineWidth(0.4).strokeColor("#9AA5B1").moveTo(X(c.x), Y(c.y + 11)).lineTo(X(x2), Y(c.y + 11)).stroke().restore();
    });
    const yT = C.encabezadoTabla.y;
    doc.save().rect(X(0), Y(yT), C.ancho, C.encabezadoTabla.alto).fill("#222222").restore();
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#FFFFFF")
      .text("CUENTA No.", X(col.cuenta + 4), Y(yT + 2.5), { width: col.concepto - 8 })
      .text("C O N C E P T O", X(col.concepto), Y(yT + 2.5), { width: col.debe - col.concepto, align: "center" })
      .text("DEBE", X(col.debe), Y(yT + 2.5), { width: col.haber - col.debe, align: "center" })
      .text("HABER", X(col.haber), Y(yT + 2.5), { width: col.fin - col.haber, align: "center" });
    doc.save().lineWidth(0.5).strokeColor("#555555");
    [col.concepto, col.debe, col.haber].forEach((x) => doc.moveTo(X(x), Y(yT)).lineTo(X(x), Y(fondoTabla)).stroke());
    doc.moveTo(X(0), Y(fondoTabla)).lineTo(X(C.ancho), Y(fondoTabla)).stroke();
    doc.restore();
    doc.font("Helvetica").fontSize(6).fillColor("#555555");
    C.pie.forEach((t, i) => doc.text(t, X([20, 100, 170, 320][i]), Y(fondoTabla + 3)));
    doc.text("DIA   MES   AÑO", X(C.ancho - 80), Y(fondoTabla + 3));
  }
  negro();

  // --- Cheque ---
  doc.font("Helvetica-Bold").fontSize(9.5).text(fechaLarga, X(C.fecha.x), Y(C.fecha.y), { width: C.fecha.ancho, height: 12, lineBreak: false, ellipsis: true });
  doc.font("Helvetica-Bold").fontSize(10).text(L.q(d.monto), X(C.monto.derecha - 120), Y(C.monto.y), { width: 120, align: "right", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(9.5).text(d.nombre, X(C.beneficiario.x), Y(C.beneficiario.y), { width: C.beneficiario.ancho, height: 12, lineBreak: false, ellipsis: true });
  doc.font("Helvetica").fontSize(8.5).text(letrasCheque(d.letras), X(C.letras.x), Y(C.letras.y), { width: C.letras.ancho, height: 11, lineBreak: false, ellipsis: true });
  if (C.noNegociable) doc.font("Helvetica-Bold").fontSize(8.5).text("NO NEGOCIABLE", X(C.noNegociable.x), Y(C.noNegociable.y));

  // --- Voucher ---
  doc.font("Helvetica-Bold").fontSize(9.5).text(d.nombre, X(C.vNombre.centro - C.vNombre.ancho / 2), Y(C.vNombre.y), { width: C.vNombre.ancho, align: "center", height: 12, lineBreak: false, ellipsis: true });
  doc.font("Helvetica-Bold").fontSize(7.5).text(d.descripcion, X(C.vDescripcion.x), Y(C.vDescripcion.y), { width: C.vDescripcion.ancho, height: 22 });
  if (C.vChequeNo.alinear === "right") {
    doc.font("Helvetica-Bold").fontSize(10).text(String(d.noDocumento), X(C.vChequeNo.derecha - 150), Y(C.vChequeNo.y), { width: 150, align: "right" });
  } else {
    doc.font("Helvetica-Bold").fontSize(8).text(`Cheque ${d.noDocumento}`, X(col.concepto), Y(C.vChequeNo.y), { width: col.debe - col.concepto, align: "center" });
  }

  // Partida: debe / haber.
  const fp = C.partida.fuente;
  const monto = (v, desde, hasta, y) => {
    doc.text("Q", X(desde + 6), Y(y)).text(L.q(v), X(desde), Y(y), { width: hasta - desde - 4, align: "right" });
  };
  // Si vienen más líneas que las que caben con el paso normal, se juntan un poco.
  const paso = Math.min(C.partida.paso, (C.totales.y - 4 - C.partida.y) / Math.max(d.partida.length, 1));
  let yP = C.partida.y;
  d.partida.forEach((r) => {
    doc.font("Helvetica-Bold").fontSize(fp).text(r.descripcion, X(C.partida.x), Y(yP), { width: col.debe - C.partida.x - 4, height: fp + 3, lineBreak: false, ellipsis: true });
    if (r.debe) monto(r.debe, col.debe, col.haber, yP);
    if (r.haber) monto(r.haber, col.haber, col.fin, yP);
    yP += paso;
  });
  const sumaDebe = d.partida.reduce((a, r) => a + Number(r.debe || 0), 0);
  const sumaHaber = d.partida.reduce((a, r) => a + Number(r.haber || 0), 0);
  doc.save().lineWidth(0.6).strokeColor("#000000")
    .moveTo(X(col.debe + 2), Y(C.totales.y - 3)).lineTo(X(col.fin - 2), Y(C.totales.y - 3)).stroke().restore();
  doc.font("Helvetica-Bold").fontSize(fp);
  monto(sumaDebe, col.debe, col.haber, C.totales.y);
  monto(sumaHaber, col.haber, col.fin, C.totales.y);
  doc.save().lineWidth(1).strokeColor("#000000")
    .moveTo(X(col.debe + 2), Y(C.totales.y + fp + 4)).lineTo(X(col.fin - 2), Y(C.totales.y + fp + 4)).stroke().restore();

  // Recibido (lo llena quien recibe el cheque).
  ["Nombre:", "Fecha y Hora de Recibido:", "No. DPI:"].forEach((t, i) => {
    const y = C.recibido.y[i];
    doc.font("Helvetica-Bold").fontSize(8).text(t, X(C.recibido.x), Y(y), { lineBreak: false });
    const xIni = C.recibido.x + doc.widthOfString(t) + 3;
    doc.save().lineWidth(0.5).strokeColor("#000000").moveTo(X(xIni), Y(y + 8)).lineTo(X(C.recibido.hasta), Y(y + 8)).stroke().restore();
  });
  doc.font("Helvetica-Bold").fontSize(8.5).text(fechaCorta, X(C.vFecha.derecha - 80), Y(C.vFecha.y), { width: 80, align: "right" });
};

const generarChequePdf = async (id, usuario, modo = "completo") => {
  const L = require("../utils/pdfLayout");
  const { numeroALetras } = require("../utils/numeroALetras");
  const [rows] = await pool.execute(sql("pagoPorId"), [id]);
  if (!rows[0]) throw createError("Pago de dieta no encontrado", 404);
  const p = mapPago(rows[0]);
  if (p.tipoDocumento !== "CHEQUE" || !p.noDocumento) throw createError("Este pago no se emitió con cheque", 409);
  const [ses] = await pool.execute(sql("detalleSesiones"), [id]);

  const completo = modo !== "preimpreso";

  // Bancos con formato propio de cheque-voucher (BI, Banrural).
  const formato = formatoCheque(p.banco);
  if (formato) {
    const [anioBI, mesBI] = String(p.periodo || "").split("-");
    const docBI = L.nuevoDoc({ size: "LETTER", margin: 0 });
    dibujarChequeBanco(docBI, {
      fechaPago: p.fechaPago, monto: p.valorPago, nombre: p.juntaNombre.toUpperCase(), letras: numeroALetras(p.valorPago),
      noDocumento: p.noDocumento,
      descripcion: `PAGO DE DIETAS POR ASISTENCIA A ${p.totalSesiones} SESION(ES) DE JUNTA DIRECTIVA, ${String(p.juntaPuesto || "").toUpperCase()}, CORRESPONDIENTE AL MES DE ${mesBI ? MESES_BI[Number(mesBI) - 1] : ""} DEL AÑO ${anioBI || ""}.`,
      partida: [
        { descripcion: CUENTAS_DIETA.gasto.nombre, debe: p.valor },
        { descripcion: CUENTAS_DIETA.isr.nombre, haber: p.isr },
        { descripcion: formato.cuentaBanco, haber: p.valorPago }
      ].filter((r) => Number(r.debe || r.haber || 0) > 0)
    }, completo, L, formato);
    logger.info("Cheque de dieta impreso", { id, banco: formato.nombre, cheque: p.noDocumento, modo, usuario });
    return { buffer: await L.aBuffer(docBI), filename: `cheque_${p.noDocumento}.pdf` };
  }

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
