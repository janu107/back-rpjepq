const PDFDocument = require("pdfkit");
const dayjs = require("dayjs");

// ============================================================================
// Utilidades de maquetación PDF compartidas por las impresiones formales
// (nóminas en oficio, estados de cuenta y resúmenes en carta).
// Aquí no hay reglas de negocio: sólo geometría, tablas, totales y firmas.
// ============================================================================

// "Oficio" en Guatemala equivale al tamaño legal (8.5 x 14"). Las nóminas van
// apaisadas porque llevan muchas columnas; los reportes de carta, verticales.
const OFICIO = { size: "LEGAL", layout: "landscape", margin: 24 };
const CARTA = { size: "LETTER", layout: "portrait", margin: 40 };

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

const num = (v) => Number(v || 0);
const q = (v) => num(v).toFixed(2);
const fecha = (v) => (v ? dayjs(v).format("DD/MM/YYYY") : "");
const fechaLarga = (v) => {
  const d = v ? dayjs(v) : dayjs();
  return `${d.date()} DE ${MESES[d.month()]} DE ${d.year()}`;
};

const nuevoDoc = (config) => new PDFDocument({ ...config, bufferPages: true });

const aBuffer = (doc) => new Promise((resolve, reject) => {
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);
  doc.end();
});

const anchoUtil = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

// Reparte un ancho total entre columnas según pesos relativos, para que la
// tabla ocupe exactamente el ancho útil sin importar el tamaño de página.
const repartirAnchos = (doc, pesos) => {
  const total = pesos.reduce((s, p) => s + p, 0);
  const disponible = anchoUtil(doc);
  return pesos.map((p) => (p / total) * disponible);
};

const encabezado = (doc, { titulo, subtitulo, lineas = [] }) => {
  doc.font("Helvetica-Bold").fontSize(12).text("ASOCIACION DEL REGIMEN DE PREVISION SOCIAL", { align: "center" });
  doc.fontSize(10).text("EMPRESA PORTUARIA QUETZAL", { align: "center" });
  doc.moveDown(0.25).fontSize(10).text(String(titulo || "").toUpperCase(), { align: "center" });
  if (subtitulo) doc.font("Helvetica").fontSize(8).text(subtitulo, { align: "center" });
  if (lineas.length) {
    doc.font("Helvetica").fontSize(7.5);
    lineas.filter(Boolean).forEach((l) => doc.text(l, { align: "center" }));
  }
  doc.moveDown(0.4);
};

// columnas: [{ titulo, campo | valor(fila), ancho, align }]
const dibujarTabla = (doc, columnas, filas, opciones = {}) => {
  const {
    fuente = 6.5, alturaFila = 12, altoEncabezado = 21,
    reservaInferior = 0, alRepetirEncabezado
  } = opciones;
  const x0 = doc.page.margins.left;
  const anchoTabla = columnas.reduce((s, c) => s + c.ancho, 0);
  const limiteInferior = doc.page.height - doc.page.margins.bottom - reservaInferior;

  const pintarEncabezado = () => {
    const y = doc.y;
    doc.save().rect(x0, y, anchoTabla, altoEncabezado).fill("#1F4E5F").restore();
    let x = x0;
    doc.font("Helvetica-Bold").fontSize(fuente).fillColor("#FFFFFF");
    columnas.forEach((c) => {
      // Sin lineBreak:false: los títulos largos ("TOTAL HORAS NORMAL Q.") se parten
      // en dos renglones en vez de recortarse.
      doc.text(c.titulo, x + 2, y + 2.5, { width: c.ancho - 4, align: c.align || "left", height: altoEncabezado - 3, lineGap: -1 });
      x += c.ancho;
    });
    doc.fillColor("#000000");
    doc.y = y + altoEncabezado;
  };

  pintarEncabezado();

  filas.forEach((fila, i) => {
    if (doc.y + alturaFila > limiteInferior) {
      doc.addPage();
      if (alRepetirEncabezado) alRepetirEncabezado(doc);
      pintarEncabezado();
    }
    const y = doc.y;
    if (i % 2 === 1) doc.save().rect(x0, y, anchoTabla, alturaFila).fill("#F3F6F8").restore();
    let x = x0;
    doc.font("Helvetica").fontSize(fuente).fillColor("#000000");
    columnas.forEach((c) => {
      const valor = c.valor ? c.valor(fila) : fila[c.campo];
      doc.text(valor === null || valor === undefined ? "" : String(valor),
        x + 2, y + 3, { width: c.ancho - 4, align: c.align || "left", lineBreak: false, ellipsis: true });
      x += c.ancho;
    });
    doc.y = y + alturaFila;
  });

  doc.x = x0;
  return doc.y;
};

// valores: objeto { <campo>: "texto ya formateado" }
// La etiqueta se dibuja abarcando las primeras `columnasEtiqueta` columnas, porque
// la primera suele ser muy angosta (el "No.") y el texto quedaría partido.
const filaTotales = (doc, columnas, valores, etiqueta = "TOTALES", columnasEtiqueta = 3) => {
  const x0 = doc.page.margins.left;
  const anchoTabla = columnas.reduce((s, c) => s + c.ancho, 0);
  if (doc.y + 14 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const y = doc.y;
  doc.save().rect(x0, y, anchoTabla, 14).fill("#DDE3EA").restore();
  const abarcadas = Math.min(columnasEtiqueta, columnas.length);
  const anchoEtiqueta = columnas.slice(0, abarcadas).reduce((s, c) => s + c.ancho, 0);

  doc.font("Helvetica-Bold").fontSize(6.8).fillColor("#000000");
  doc.text(String(etiqueta), x0 + 2, y + 4, { width: anchoEtiqueta - 4, align: "left", lineBreak: false, ellipsis: true });

  let x = x0 + anchoEtiqueta;
  columnas.slice(abarcadas).forEach((c) => {
    doc.text(String(valores[c.campo] ?? ""), x + 2, y + 4,
      { width: c.ancho - 4, align: c.align || "right", lineBreak: false });
    x += c.ancho;
  });
  doc.y = y + 14;
  doc.x = x0;
  return doc.y;
};

// Los nombres de quienes firman llegan desde la pantalla: no se codifica
// ninguna persona en el sistema.
const bloqueFirmas = (doc, firmas = []) => {
  const utiles = firmas.filter((f) => f && (f.nombre || f.rol));
  if (!utiles.length) return;

  const alto = 46;
  if (doc.y + alto + 24 > doc.page.height - doc.page.margins.bottom) doc.addPage();

  const columna = anchoUtil(doc) / utiles.length;
  const yBase = doc.y + 26;
  utiles.forEach((f, i) => {
    const x = doc.page.margins.left + i * columna;
    doc.moveTo(x + 10, yBase).lineTo(x + columna - 10, yBase).strokeColor("#000000").lineWidth(0.6).stroke();
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#000000")
      .text(String(f.nombre || ""), x + 6, yBase + 4, { width: columna - 12, align: "center" });
    doc.font("Helvetica").fontSize(6.5)
      .text(String(f.cargo || ""), x + 6, yBase + 14, { width: columna - 12, align: "center" });
    doc.font("Helvetica-Oblique").fontSize(6)
      .text(String(f.rol || ""), x + 6, yBase + 24, { width: columna - 12, align: "center" });
  });
  doc.y = yBase + alto;
};

const pieDePagina = (doc, usuario) => {
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i += 1) {
    doc.switchToPage(paginas.start + i);
    doc.font("Helvetica").fontSize(6).fillColor("#666666").text(
      `Generado por ${usuario || "sistema"} el ${dayjs().format("DD/MM/YYYY HH:mm")}   ·   Página ${i + 1} de ${paginas.count}`,
      doc.page.margins.left,
      doc.page.height - doc.page.margins.bottom + 8,
      { width: anchoUtil(doc), align: "right", lineBreak: false }
    );
  }
  doc.fillColor("#000000");
};

module.exports = {
  OFICIO, CARTA, num, q, fecha, fechaLarga,
  nuevoDoc, aBuffer, anchoUtil, repartirAnchos,
  encabezado, dibujarTabla, filaTotales, bloqueFirmas, pieDePagina
};
