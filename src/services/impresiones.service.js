const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { numeroALetras } = require("../utils/numeroALetras");
const pdf = require("../utils/pdfLayout");

// ============================================================================
// Impresiones formales (mejoras 14-18 del documento):
//   14. Nómina de sueldos de empleados de régimen — oficio, agrupada por área
//   15. Nómina de tiempo extraordinario           — oficio, agrupada por área
//   16. Estado de cuenta de préstamo EPQ          — carta vertical
//   17. Resumen por área y por concepto           — carta vertical
//   18. Nómina mensual de préstamos EPQ           — oficio
//
// El ÁREA no se lee de nin_area: los SP de nómina guardan ahí la constante
// 'TRABAJADORES'. Se resuelve por el puesto del empleado
// (RPJ_MNT_EMPLEADO -> RPJ_CAT_PUESTO -> RPJ_CAT_AREA); quien no tenga puesto
// o área asignada aparece bajo "SIN AREA".
// ============================================================================

const sql = (file) => getSql(`impresiones/${file}.sql`);
const { num, q, fecha, fechaLarga } = pdf;

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const sumar = (filas, campo) => filas.reduce((s, f) => s + num(f[campo]), 0);

// Agrupa conservando el orden en que vienen (la consulta ya ordena por área).
const agruparPorArea = (filas) => {
  const mapa = new Map();
  filas.forEach((f) => {
    const clave = f.area || "SIN AREA";
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(f);
  });
  return [...mapa.entries()];
};

// Las firmas llegan desde la pantalla como JSON; el sistema no codifica personas.
const parsearFirmas = (raw) => {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.slice(0, 4) : [];
  } catch {
    return [];
  }
};

const getPlanilla = async (idPlanilla) => {
  const [rows] = await pool.execute(
    `SELECT ppl_correlativo AS id, ppl_tipo_planilla AS tipoPlanilla, ppl_numero AS numero,
            ppl_fecha_inicio AS fechaInicio, ppl_fecha_final AS fechaFinal,
            ppl_fecha_pago AS fechaPago, ppl_estado_proceso AS estadoProceso
       FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = ?`,
    [idPlanilla]
  );
  if (!rows[0]) throw createError("Planilla no encontrada", 404);
  return rows[0];
};

// Cierre común de las nóminas: monto en letras, lugar/fecha y firmas.
const cierreNomina = (doc, { total, fechaPago, firmas }) => {
  doc.moveDown(0.8);
  doc.x = doc.page.margins.left;
  doc.font("Helvetica").fontSize(7.5).text(
    `LA PRESENTE PLANILLA ASCIENDE A LA CANTIDAD DE ${numeroALetras(total)}`,
    { width: pdf.anchoUtil(doc) * 0.62 }
  );
  doc.font("Helvetica").fontSize(7.5).text(`PUERTO QUETZAL, ${fechaLarga(fechaPago)}`);
  pdf.bloqueFirmas(doc, firmas);
};

// ---------------------------------------------------------------------------
// 14. Nómina de sueldos de empleados de régimen (oficio, por área)
// ---------------------------------------------------------------------------
const COLS_SUELDOS = (doc) => {
  const anchos = pdf.repartirAnchos(doc, [3, 18, 4, 7, 4, 15, 8, 8, 8, 7, 7, 8, 8, 9]);
  const c = (titulo, campo, align, i, valor) => ({ titulo, campo, align, ancho: anchos[i], valor });
  return [
    c("No.", "no", "right", 0),
    c("NOMBRES Y APELLIDOS", "nombre", "left", 1),
    c("AREA", "areaCorta", "center", 2),
    c("F. INICIO", "fechaInicioLabor", "center", 3, (f) => fecha(f.fecha_inicio_labor)),
    c("DIAS", "dias", "right", 4),
    c("CARGO", "cargo", "left", 5),
    c("SUELDO MENSUAL", "sueldo", "right", 6, (f) => q(f.sueldo)),
    c("BONIF. INCENTIVO", "bonif_incentivo", "right", 7, (f) => q(f.bonif_incentivo)),
    c("BONIF. PROD. Y EFIC.", "bonif_productividad", "right", 8, (f) => q(f.bonif_productividad)),
    c("I.G.S.S.", "igss", "right", 9, (f) => q(f.igss)),
    c("I.S.R.", "isr", "right", 10, (f) => q(f.isr)),
    c("SEG. JUD. Y OTROS", "judicial_otros", "right", 11, (f) => q(f.judicial_otros)),
    c("PRESTAMOS", "prestamos", "right", 12, (f) => q(f.prestamos)),
    c("LIQUIDO A RECIBIR", "liquido", "right", 13, (f) => q(f.liquido))
  ];
};

const totalesSueldos = (filas) => ({
  sueldo: q(sumar(filas, "sueldo")),
  bonif_incentivo: q(sumar(filas, "bonif_incentivo")),
  bonif_productividad: q(sumar(filas, "bonif_productividad")),
  igss: q(sumar(filas, "igss")),
  isr: q(sumar(filas, "isr")),
  judicial_otros: q(sumar(filas, "judicial_otros")),
  prestamos: q(sumar(filas, "prestamos")),
  liquido: q(sumar(filas, "liquido"))
});

const getNominaSueldos = async (idPlanilla) => {
  const planilla = await getPlanilla(idPlanilla);
  const [rows] = await pool.execute(sql("nominaSueldos"), [idPlanilla, idPlanilla]);
  return { planilla, filas: rows };
};

const pdfNominaSueldos = async (idPlanilla, opciones = {}, user) => {
  const { planilla, filas } = await getNominaSueldos(idPlanilla);
  if (!filas.length) throw createError("La planilla no tiene renglones de empleados para imprimir", 409);

  const firmas = parsearFirmas(opciones.firmas);
  const porArea = String(opciones.porArea ?? "true") !== "false";
  const doc = pdf.nuevoDoc(pdf.OFICIO);
  const columnas = COLS_SUELDOS(doc);

  const cabecera = (d) => pdf.encabezado(d, {
    titulo: "NOMINA DE SUELDOS - EMPLEADOS DE REGIMEN",
    subtitulo: `Planilla ${planilla.numero}   ·   Período ${fecha(planilla.fechaInicio)} al ${fecha(planilla.fechaFinal)}   ·   Pago ${fecha(planilla.fechaPago)}`
  });
  cabecera(doc);

  const grupos = porArea ? agruparPorArea(filas) : [["", filas]];
  grupos.forEach(([area, filasArea], idx) => {
    if (idx > 0) doc.moveDown(0.8);
    if (porArea) {
      doc.font("Helvetica-Bold").fontSize(8).text(`AREA: ${area}`);
      doc.moveDown(0.15);
    }
    const numeradas = filasArea.map((f, i) => ({
      ...f, no: i + 1, areaCorta: (f.area || "").slice(0, 3)
    }));
    pdf.dibujarTabla(doc, columnas, numeradas, { fuente: 6, alturaFila: 11, reservaInferior: 70, alRepetirEncabezado: cabecera });
    pdf.filaTotales(doc, columnas, totalesSueldos(filasArea), porArea ? `TOTAL ${area}` : "TOTALES");
  });

  if (porArea && grupos.length > 1) {
    doc.moveDown(0.4);
    pdf.filaTotales(doc, columnas, totalesSueldos(filas), "TOTAL GENERAL");
  }

  cierreNomina(doc, { total: sumar(filas, "liquido"), fechaPago: planilla.fechaPago, firmas });
  pdf.pieDePagina(doc, user?.usuario);

  logger.info("Impresión de nómina de sueldos", { idPlanilla, empleados: filas.length, usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `nomina_sueldos_${planilla.numero}.pdf` };
};

// ---------------------------------------------------------------------------
// 15. Nómina de tiempo extraordinario (oficio, por área)
// ---------------------------------------------------------------------------
const COLS_EXTRA = (doc) => {
  const anchos = pdf.repartirAnchos(doc, [3, 20, 4, 16, 9, 8, 6, 9, 8, 6, 9, 9, 8, 9]);
  const c = (titulo, campo, align, i, valor) => ({ titulo, campo, align, ancho: anchos[i], valor });
  return [
    c("No.", "no", "right", 0),
    c("NOMBRE", "nombre", "left", 1),
    c("AREA", "areaCorta", "center", 2),
    c("CARGO", "cargo", "left", 3),
    c("SALARIO MENSUAL", "salario_mensual", "right", 4, (f) => q(f.salario_mensual)),
    c("VALOR EXTRA NORMAL", "valor_hora_normal", "right", 5, (f) => q(f.valor_hora_normal)),
    c("HORAS NORM.", "horas_normales", "right", 6),
    c("TOTAL HORAS NORMAL Q.", "total_normal", "right", 7, (f) => q(f.total_normal)),
    c("VALOR EXTRA DOBLE", "valor_hora_doble", "right", 8, (f) => q(f.valor_hora_doble)),
    c("HORAS DOBLES", "horas_dobles", "right", 9),
    c("TOTAL HORAS DOBLE Q.", "total_doble", "right", 10, (f) => q(f.total_doble)),
    c("TOTAL", "total", "right", 11, (f) => q(f.total)),
    c("DESCUENTO I.G.S.S.", "igss", "right", 12, (f) => q(f.igss)),
    c("LIQUIDO A RECIBIR", "liquido", "right", 13, (f) => q(f.liquido))
  ];
};

const totalesExtra = (filas) => ({
  total_normal: q(sumar(filas, "total_normal")),
  horas_normales: String(sumar(filas, "horas_normales")),
  total_doble: q(sumar(filas, "total_doble")),
  horas_dobles: String(sumar(filas, "horas_dobles")),
  total: q(sumar(filas, "total")),
  igss: q(sumar(filas, "igss")),
  liquido: q(sumar(filas, "liquido"))
});

const getNominaTiempoExtra = async (idPlanilla) => {
  const planilla = await getPlanilla(idPlanilla);
  const [rows] = await pool.execute(sql("nominaTiempoExtra"), [idPlanilla, idPlanilla]);
  return { planilla, filas: rows };
};

const pdfNominaTiempoExtra = async (idPlanilla, opciones = {}, user) => {
  const { planilla, filas } = await getNominaTiempoExtra(idPlanilla);
  if (!filas.length) throw createError("La planilla no tiene renglones de tiempo extra para imprimir", 409);

  const firmas = parsearFirmas(opciones.firmas);
  const porArea = String(opciones.porArea ?? "true") !== "false";
  const doc = pdf.nuevoDoc(pdf.OFICIO);
  const columnas = COLS_EXTRA(doc);

  const cabecera = (d) => pdf.encabezado(d, {
    titulo: "NOMINA DE TIEMPO EXTRAORDINARIO - EMPLEADOS DE REGIMEN",
    subtitulo: `Planilla ${planilla.numero}   ·   Período ${fecha(planilla.fechaInicio)} al ${fecha(planilla.fechaFinal)}   ·   Pago ${fecha(planilla.fechaPago)}`
  });
  cabecera(doc);

  const grupos = porArea ? agruparPorArea(filas) : [["", filas]];
  grupos.forEach(([area, filasArea], idx) => {
    if (idx > 0) doc.moveDown(0.8);
    if (porArea) {
      doc.font("Helvetica-Bold").fontSize(8).text(`AREA: ${area}`);
      doc.moveDown(0.15);
    }
    const numeradas = filasArea.map((f, i) => ({ ...f, no: i + 1, areaCorta: (f.area || "").slice(0, 3) }));
    pdf.dibujarTabla(doc, columnas, numeradas, { fuente: 6, alturaFila: 11, reservaInferior: 70, alRepetirEncabezado: cabecera });
    pdf.filaTotales(doc, columnas, totalesExtra(filasArea), porArea ? `TOTAL ${area}` : "TOTALES");
  });

  if (porArea && grupos.length > 1) {
    doc.moveDown(0.4);
    pdf.filaTotales(doc, columnas, totalesExtra(filas), "TOTAL GENERAL");
  }

  cierreNomina(doc, { total: sumar(filas, "total"), fechaPago: planilla.fechaPago, firmas });
  pdf.pieDePagina(doc, user?.usuario);

  logger.info("Impresión de nómina de tiempo extra", { idPlanilla, empleados: filas.length, usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `nomina_tiempo_extra_${planilla.numero}.pdf` };
};

// ---------------------------------------------------------------------------
// 16. Estado de cuenta de préstamo de empleado EPQ (carta vertical)
// ---------------------------------------------------------------------------
const getEstadoCuentaPrestamo = async (idPrestamo) => {
  const [cab] = await pool.execute(sql("prestamoCabecera"), [idPrestamo]);
  if (!cab[0]) throw createError("Préstamo no encontrado", 404);
  const [det] = await pool.execute(sql("prestamoDetalle"), [idPrestamo]);
  return { prestamo: cab[0], movimientos: det };
};

const pdfEstadoCuentaPrestamo = async (idPrestamo, opciones = {}, user) => {
  const { prestamo, movimientos } = await getEstadoCuentaPrestamo(idPrestamo);
  const doc = pdf.nuevoDoc(pdf.CARTA);

  pdf.encabezado(doc, {
    titulo: "ESTADO DE CUENTA DE PRESTAMO",
    subtitulo: `${prestamo.cliente}   ·   Contrato ${prestamo.no_contrato}`
  });

  // Ficha de datos del préstamo en dos columnas.
  const ancho = pdf.anchoUtil(doc);
  const media = ancho / 2;
  const izquierda = [
    ["GERENCIA:", prestamo.gerencia || ""],
    ["MONTO AUTORIZADO:", `Q ${q(prestamo.monto_autorizado)}`],
    ["CUOTA NIVELADA:", `Q ${q(prestamo.cuota_nivelada)}`],
    ["TASA DE INTERES ANUAL:", `${q(prestamo.tasa_interes)} %`]
  ];
  const derecha = [
    ["FECHA INICIO:", fecha(prestamo.fecha_inicio)],
    ["FECHA FINAL:", fecha(prestamo.fecha_fin)],
    ["PLAZO (MESES):", String(prestamo.plazo_meses ?? "")],
    ["TOTAL A PAGAR:", `Q ${q(prestamo.total_pagar)}`]
  ];
  const yFicha = doc.y;
  const pintarFicha = (lista, x) => {
    let y = yFicha;
    lista.forEach(([etiqueta, valor]) => {
      doc.font("Helvetica-Bold").fontSize(8).text(etiqueta, x, y, { width: media * 0.55, lineBreak: false });
      doc.font("Helvetica").fontSize(8).text(valor, x + media * 0.55, y, { width: media * 0.42, align: "right", lineBreak: false });
      y += 13;
    });
    return y;
  };
  const yIzq = pintarFicha(izquierda, doc.page.margins.left);
  const yDer = pintarFicha(derecha, doc.page.margins.left + media);
  doc.y = Math.max(yIzq, yDer) + 10;

  const anchos = pdf.repartirAnchos(doc, [11, 12, 9, 11, 13, 11, 13, 9]);
  const c = (titulo, campo, i, valor) => ({ titulo, campo, align: "right", ancho: anchos[i], valor });
  const columnas = [
    { titulo: "MES", campo: "fecha_pago", align: "center", ancho: anchos[0], valor: (f) => fecha(f.fecha_pago) },
    c("DESCUENTO NOMINA", "descuento_nomina", 1, (f) => q(f.descuento_nomina)),
    c("SEGURO", "seguro", 2, (f) => q(f.seguro)),
    c("CUOTA NIVELADA", "cuota_nivelada", 3, (f) => q(f.cuota_nivelada)),
    c("AMORTIZACION CAPITAL", "amortizacion", 4, (f) => q(f.amortizacion)),
    c("INTERESES", "intereses", 5, (f) => q(f.intereses)),
    c("SALDO CAPITAL", "saldo", 6, (f) => q(f.saldo)),
    c("MORA", "mora", 7, (f) => q(f.mora))
  ];

  if (!movimientos.length) {
    doc.font("Helvetica-Oblique").fontSize(8).text("El préstamo no tiene movimientos registrados.");
  } else {
    pdf.dibujarTabla(doc, columnas, movimientos, { fuente: 7, alturaFila: 12, reservaInferior: 60 });
    pdf.filaTotales(doc, columnas, {
      descuento_nomina: q(sumar(movimientos, "descuento_nomina")),
      seguro: q(sumar(movimientos, "seguro")),
      cuota_nivelada: q(sumar(movimientos, "cuota_nivelada")),
      amortizacion: q(sumar(movimientos, "amortizacion")),
      intereses: q(sumar(movimientos, "intereses")),
      mora: q(sumar(movimientos, "mora"))
    }, "TOTALES", 1);
  }

  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(7.5).text("ELABORADO:");
  doc.text(String(opciones.elaboradoPor || "Departamento de Credito"));
  pdf.pieDePagina(doc, user?.usuario);

  logger.info("Impresión de estado de cuenta de préstamo", { idPrestamo, usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `estado_cuenta_prestamo_${prestamo.no_contrato || idPrestamo}.pdf` };
};

// ---------------------------------------------------------------------------
// 17. Resumen por área y por concepto (carta vertical)
// ---------------------------------------------------------------------------
const getResumen = async ({ tipoManejo, desde, hasta }) => {
  const manejo = Number(tipoManejo);
  if (![1, 2].includes(manejo)) throw createError("El tipo de manejo debe ser 1 (régimen) o 2 (jubilados)");
  if (!desde || !hasta) throw createError("Debe indicar el rango de fechas de pago");

  const [areas] = await pool.query(sql("resumenPorArea"), [manejo, manejo, desde, hasta]);
  const [conceptos] = await pool.query(sql("resumenPorConcepto"), [manejo, desde, hasta]);
  return { tipoManejo: manejo, desde, hasta, areas, conceptos };
};

const pdfResumen = async (query, user) => {
  const { tipoManejo, desde, hasta, areas, conceptos } = await getResumen(query);
  const doc = pdf.nuevoDoc(pdf.CARTA);

  pdf.encabezado(doc, {
    titulo: "REPORTE DE RESUMEN",
    subtitulo: tipoManejo === 1 ? "Empleados de régimen" : "Jubilados y pensionados",
    lineas: [`Pagos del ${fecha(desde)} al ${fecha(hasta)}`]
  });

  // Bloque 1: por área (nominal vs líquido)
  doc.font("Helvetica-Bold").fontSize(9).text("RESUMEN POR AREA");
  doc.moveDown(0.2);
  const anchosA = pdf.repartirAnchos(doc, [40, 14, 23, 23]);
  const colsArea = [
    { titulo: "AREA", campo: "area", align: "left", ancho: anchosA[0] },
    { titulo: "PERSONAS", campo: "personas", align: "right", ancho: anchosA[1] },
    { titulo: "NOMINAL", campo: "nominal", align: "right", ancho: anchosA[2], valor: (f) => `Q ${q(f.nominal)}` },
    { titulo: "LIQUIDO", campo: "liquido", align: "right", ancho: anchosA[3], valor: (f) => `Q ${q(f.liquido)}` }
  ];
  if (areas.length) {
    pdf.dibujarTabla(doc, colsArea, areas, { fuente: 8, alturaFila: 14 });
    pdf.filaTotales(doc, colsArea, {
      personas: String(areas.reduce((s, a) => s + num(a.personas), 0)),
      nominal: `Q ${q(sumar(areas, "nominal"))}`,
      liquido: `Q ${q(sumar(areas, "liquido"))}`
    }, "TOTALES", 1);
  } else {
    doc.font("Helvetica-Oblique").fontSize(8).text("Sin movimientos en el rango indicado.");
  }

  // Bloque 2: por concepto (sueldos, extras, bono vacacional, aguinaldo, bono 14)
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(9).text("RESUMEN POR CONCEPTO");
  doc.moveDown(0.2);
  const anchosC = pdf.repartirAnchos(doc, [45, 20, 35]);
  const colsConcepto = [
    { titulo: "CONCEPTO", campo: "concepto", align: "left", ancho: anchosC[0] },
    { titulo: "PERSONAS", campo: "personas", align: "right", ancho: anchosC[1] },
    { titulo: "NOMINAL", campo: "nominal", align: "right", ancho: anchosC[2], valor: (f) => `Q ${q(f.nominal)}` }
  ];
  if (conceptos.length) {
    pdf.dibujarTabla(doc, colsConcepto, conceptos, { fuente: 8, alturaFila: 14 });
    pdf.filaTotales(doc, colsConcepto, { nominal: `Q ${q(sumar(conceptos, "nominal"))}` }, "TOTALES", 1);
  } else {
    doc.font("Helvetica-Oblique").fontSize(8).text("Sin movimientos en el rango indicado.");
  }

  pdf.pieDePagina(doc, user?.usuario);
  logger.info("Impresión de resumen", { tipoManejo, desde, hasta, usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `resumen_${tipoManejo === 1 ? "regimen" : "jubilados"}_${desde}_${hasta}.pdf` };
};

// ---------------------------------------------------------------------------
// 18. Nómina mensual de préstamos EPQ (oficio)
// ---------------------------------------------------------------------------
const getNominaPrestamos = async ({ desde, hasta }) => {
  if (!desde || !hasta) throw createError("Debe indicar el rango de fechas de pago");
  const [rows] = await pool.execute(sql("nominaPrestamos"), [desde, hasta]);
  return rows;
};

const pdfNominaPrestamos = async (query, user) => {
  const filas = await getNominaPrestamos(query);
  if (!filas.length) throw createError("No hay movimientos de préstamos en el rango indicado", 409);

  const firmas = parsearFirmas(query.firmas);
  const doc = pdf.nuevoDoc(pdf.OFICIO);
  const anchos = pdf.repartirAnchos(doc, [3, 5, 20, 7, 9, 4, 8, 8, 9, 7, 9, 10, 9, 9, 9]);
  const c = (titulo, campo, i, valor, align = "right") => ({ titulo, campo, align, ancho: anchos[i], valor });
  const columnas = [
    c("No.", "no", 0, undefined, "right"),
    c("CODIGO", "codigo", 1, undefined, "right"),
    c("NOMBRE DEL CLIENTE", "cliente", 2, undefined, "left"),
    c("No. PRESTAMO", "no_contrato", 3, undefined, "left"),
    c("MONTO PRESTAMO", "monto_prestamo", 4, (f) => q(f.monto_prestamo)),
    c("PLAZO", "plazo_meses", 5),
    c("FECHA INICIO", "fecha_inicio", 6, (f) => fecha(f.fecha_inicio), "center"),
    c("FECHA FINAL", "fecha_fin", 7, (f) => fecha(f.fecha_fin), "center"),
    c("DESCUENTO NOMINA", "descuento_nomina", 8, (f) => q(f.descuento_nomina)),
    c("SEGURO", "seguro", 9, (f) => q(f.seguro)),
    c("CUOTA NIVELADA", "cuota_nivelada", 10, (f) => q(f.cuota_nivelada)),
    c("AMORTIZACION CAPITAL", "amortizacion_capital", 11, (f) => q(f.amortizacion_capital)),
    c("INTERESES DEL MES", "intereses_del_mes", 12, (f) => q(f.intereses_del_mes)),
    c("SALDO MES ANTERIOR", "saldo_mes_anterior", 13, (f) => q(f.saldo_mes_anterior)),
    c("SALDO ACTUAL", "saldo_actual", 14, (f) => q(f.saldo_actual))
  ];

  const cabecera = (d) => pdf.encabezado(d, {
    titulo: "NOMINA MENSUAL DE PRESTAMOS - EMPLEADOS EPQ",
    subtitulo: `Movimientos del ${fecha(query.desde)} al ${fecha(query.hasta)}`
  });
  cabecera(doc);

  pdf.dibujarTabla(doc, columnas, filas.map((f, i) => ({ ...f, no: i + 1 })),
    { fuente: 6, alturaFila: 11, reservaInferior: 70, alRepetirEncabezado: cabecera });

  pdf.filaTotales(doc, columnas, {
    monto_prestamo: q(sumar(filas, "monto_prestamo")),
    descuento_nomina: q(sumar(filas, "descuento_nomina")),
    seguro: q(sumar(filas, "seguro")),
    cuota_nivelada: q(sumar(filas, "cuota_nivelada")),
    amortizacion_capital: q(sumar(filas, "amortizacion_capital")),
    intereses_del_mes: q(sumar(filas, "intereses_del_mes")),
    saldo_actual: q(sumar(filas, "saldo_actual"))
  });

  doc.moveDown(0.8);
  doc.x = doc.page.margins.left;
  doc.font("Helvetica").fontSize(7.5).text(
    `EL PRESENTE DESCUENTO ASCIENDE A LA CANTIDAD DE ${numeroALetras(sumar(filas, "descuento_nomina"))}`,
    { width: pdf.anchoUtil(doc) * 0.62 }
  );
  pdf.bloqueFirmas(doc, firmas);
  pdf.pieDePagina(doc, user?.usuario);

  logger.info("Impresión de nómina de préstamos EPQ", { desde: query.desde, hasta: query.hasta, filas: filas.length, usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `nomina_prestamos_${query.desde}_${query.hasta}.pdf` };
};

module.exports = {
  getNominaSueldos,
  pdfNominaSueldos,
  getNominaTiempoExtra,
  pdfNominaTiempoExtra,
  getEstadoCuentaPrestamo,
  pdfEstadoCuentaPrestamo,
  getResumen,
  pdfResumen,
  getNominaPrestamos,
  pdfNominaPrestamos
};
