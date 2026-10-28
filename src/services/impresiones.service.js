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

const SIN_AREA = "SIN AREA";

// Mapa idEmpleado -> { area, puesto }.
//
// Se consulta aparte de los reportes a propósito: el catálogo de áreas y puestos
// puede no estar poblado (o no existir) en un ambiente, y en ese caso el reporte
// debe salir igual con todos bajo "SIN AREA" en lugar de fallar entero. Por eso
// el catch: se registra el motivo y se sigue.
const getMapaAreas = async () => {
  try {
    const [rows] = await pool.execute(sql("areasPorEmpleado"));
    return new Map(rows.map((r) => [Number(r.id_empleado), { area: r.area || SIN_AREA, puesto: r.puesto }]));
  } catch (error) {
    logger.warn("No se pudo leer el catálogo de áreas/puestos; las impresiones se agruparán bajo SIN AREA", {
      code: error.code, sqlMessage: error.sqlMessage, message: error.message
    });
    return new Map();
  }
};

// Adjunta área y cargo a cada fila usando el mapa.
const conArea = (filas, mapa) => filas.map((f) => {
  const info = mapa.get(Number(f.id_empleado));
  return { ...f, area: info?.area || SIN_AREA, cargo: f.cargo || info?.puesto || "" };
});

// Agrupa por área, en orden alfabético y dejando "SIN AREA" de último.
const agruparPorArea = (filas) => {
  const mapa = new Map();
  filas.forEach((f) => {
    const clave = f.area || SIN_AREA;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(f);
  });
  return [...mapa.entries()].sort(([a], [b]) => {
    if (a === SIN_AREA) return 1;
    if (b === SIN_AREA) return -1;
    return a.localeCompare(b);
  });
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
  const [[rows], mapaAreas] = await Promise.all([
    pool.execute(sql("nominaSueldos"), [idPlanilla, idPlanilla]),
    getMapaAreas()
  ]);
  return { planilla, filas: conArea(rows, mapaAreas) };
};

const pdfNominaSueldos = async (idPlanilla, opciones = {}, user) => {
  const { planilla, filas: todas } = await getNominaSueldos(idPlanilla);
  if (!todas.length) throw createError("La planilla no tiene renglones de empleados para imprimir", 409);

  // Parámetro "area": nombre de un área del catálogo (o SIN AREA). Vacío = todas,
  // agrupadas por área. Con un área concreta, ese nombre sale al centro del encabezado.
  const areaPedida = String(opciones.area || "").trim().toUpperCase();
  const filas = areaPedida ? todas.filter((f) => String(f.area).toUpperCase() === areaPedida) : todas;
  if (!filas.length) throw createError(`La planilla no tiene empleados del área ${areaPedida}`, 409);

  const firmas = parsearFirmas(opciones.firmas);
  const porArea = !areaPedida && String(opciones.porArea ?? "true") !== "false";
  const doc = pdf.nuevoDoc(pdf.OFICIO);
  const columnas = COLS_SUELDOS(doc);

  const cabecera = (d) => pdf.encabezado(d, {
    titulo: "NOMINA DE SUELDOS - EMPLEADOS DE REGIMEN",
    area: areaPedida || null,
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
  const [[rows], mapaAreas] = await Promise.all([
    pool.execute(sql("nominaTiempoExtra"), [idPlanilla, idPlanilla]),
    getMapaAreas()
  ]);
  return { planilla, filas: conArea(rows, mapaAreas) };
};

const pdfNominaTiempoExtra = async (idPlanilla, opciones = {}, user) => {
  const { planilla, filas: todas } = await getNominaTiempoExtra(idPlanilla);
  if (!todas.length) throw createError("La planilla no tiene renglones de tiempo extra para imprimir", 409);

  // Igual que la nómina de sueldos: vacío = todas las áreas agrupadas; con un
  // área, sólo esa y su nombre al centro del encabezado.
  const areaPedida = String(opciones.area || "").trim().toUpperCase();
  const filas = areaPedida ? todas.filter((f) => String(f.area).toUpperCase() === areaPedida) : todas;
  if (!filas.length) throw createError(`La planilla no tiene tiempo extra del área ${areaPedida}`, 409);

  const firmas = parsearFirmas(opciones.firmas);
  const porArea = !areaPedida && String(opciones.porArea ?? "true") !== "false";
  const doc = pdf.nuevoDoc(pdf.OFICIO);
  const columnas = COLS_EXTRA(doc);

  const cabecera = (d) => pdf.encabezado(d, {
    titulo: "NOMINA DE TIEMPO EXTRAORDINARIO - EMPLEADOS DE REGIMEN",
    area: areaPedida || null,
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
// Estado de cuenta de aportaciones de un empleado EPQ (carta vertical).
// Se genera aquí, en el servidor, en vez de imprimir la pantalla: el diálogo
// del navegador agrega sus propios márgenes y encabezados, y el resultado no
// coincidía con el resto de las impresiones.
// ---------------------------------------------------------------------------
const getEstadoAportaciones = async (idAportacion) => {
  const [cab] = await pool.execute(sql("aportacionesCabecera"), [idAportacion]);
  if (!cab[0]) throw createError("Empleado EPQ no encontrado", 404);
  const [mov] = await pool.execute(sql("aportacionesDetalle"), [idAportacion]);
  return { empleado: cab[0], movimientos: mov };
};

// formato "anual" (por defecto): matriz año x mes, cabe en una hoja.
// formato "detalle": cada aporte, en 3 columnas por hoja.
// Agrupa los aportes por año (en orden).
const agruparPorAnio = (movimientos) => {
  const mapa = new Map();
  movimientos.forEach((m) => {
    const anio = new Date(m.fecha_pago).getFullYear();
    if (!mapa.has(anio)) mapa.set(anio, { anio, items: [], total: 0 });
    const g = mapa.get(anio);
    g.items.push(m); g.total = Math.round((g.total + Number(m.monto || 0)) * 100) / 100;
  });
  return [...mapa.values()].sort((x, y) => x.anio - y.anio);
};

// Excel del estado de cuenta de aportaciones: detalle agrupado por año y resumen año x mes.
const excelEstadoAportaciones = async (idAportacion) => {
  const ExcelJS = require("exceljs");
  const { empleado, movimientos } = await getEstadoAportaciones(idAportacion);
  if (!movimientos.length) throw createError("El empleado no tiene aportaciones registradas", 409);
  const total = Math.round(sumar(movimientos, "monto") * 100) / 100;
  const grupos = agruparPorAnio(movimientos);
  const MES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
  const MONEDA = '"Q "#,##0.00';
  const OSCURO = "FF1F4E5F"; const CLARO = "FFDDE3EA";
  const borde = { top: { style: "thin", color: { argb: "FFC9D3DD" } }, bottom: { style: "thin", color: { argb: "FFC9D3DD" } } };

  const wb = new ExcelJS.Workbook();
  wb.creator = "RPJEPQ";

  const encabezado = (ws, ncols, subtitulo) => {
    const t = (texto, tam, negrita = true) => {
      const r = ws.addRow([texto]);
      ws.mergeCells(r.number, 1, r.number, ncols);
      r.getCell(1).font = { bold: negrita, size: tam };
      r.getCell(1).alignment = { horizontal: "center" };
    };
    t("REGIMEN DE PENSIONES Y JUBILACIONES", 13);
    t("DEL PERSONAL DE LA EMPRESA PORTUARIA QUETZAL", 11);
    t("ESTADO DE CUENTA DE APORTACIONES", 11);
    t(subtitulo, 9, false);
    ws.addRow([]);
    const ficha = [
      ["NOMBRE:", empleado.nombre || ""], ["CÓDIGO:", empleado.codigo ?? ""], ["ÁREA / GERENCIA:", empleado.area || ""],
      ["ESTADO:", empleado.estado || ""], ["PERÍODO:", `${fecha(movimientos[0].fecha_pago)} al ${fecha(movimientos[movimientos.length - 1].fecha_pago)}`],
      ["CANTIDAD DE APORTES:", movimientos.length], ["TOTAL APORTADO:", total]
    ];
    ficha.forEach(([e, v]) => {
      const r = ws.addRow([e, v]);
      r.getCell(1).font = { bold: true };
      if (e === "TOTAL APORTADO:") { r.getCell(2).numFmt = MONEDA; r.getCell(2).font = { bold: true }; }
      r.getCell(2).alignment = { horizontal: "left" };
    });
    ws.addRow([]);
  };

  // --- Hoja 1: detalle por año ---
  const ws = wb.addWorksheet("Detalle por año", { pageSetup: { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  [22, 16, 16, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  encabezado(ws, 4, "Detalle de aportes por año");
  let n = 0;
  grupos.forEach((g) => {
    const banda = ws.addRow([`AÑO ${g.anio}`, "", "", `${g.items.length} aporte(s)`]);
    banda.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OSCURO } }; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; });
    banda.getCell(4).alignment = { horizontal: "right" };
    const enc = ws.addRow(["No.", "FECHA DE PAGO", "MES", "MONTO"]);
    enc.eachCell((c) => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F4F7" } }; c.border = borde; });
    enc.getCell(4).alignment = { horizontal: "right" };
    g.items.forEach((m) => {
      n += 1;
      const d = new Date(m.fecha_pago);
      const r = ws.addRow([n, new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), MES[d.getMonth()], Number(m.monto || 0)]);
      r.getCell(1).alignment = { horizontal: "left" };
      r.getCell(2).numFmt = "dd/mm/yyyy"; r.getCell(2).alignment = { horizontal: "center" };
      r.getCell(4).numFmt = MONEDA;
    });
    const sub = ws.addRow([`TOTAL ${g.anio}`, "", "", g.total]);
    sub.eachCell((c) => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLARO } }; });
    sub.getCell(4).numFmt = MONEDA;
    ws.addRow([]);
  });
  const tot = ws.addRow([`TOTAL GENERAL (${movimientos.length} aportes)`, "", "", total]);
  tot.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OSCURO } }; });
  tot.getCell(4).numFmt = MONEDA;

  // --- Hoja 2: resumen año x mes ---
  const wr = wb.addWorksheet("Resumen anual", { pageSetup: { paperSize: 1, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const MES3 = MES.map((m) => m.slice(0, 3));
  const ncols = 15;
  wr.getColumn(1).width = 8;
  for (let i = 2; i <= 13; i += 1) wr.getColumn(i).width = 11;
  wr.getColumn(14).width = 10; wr.getColumn(15).width = 14;
  encabezado(wr, ncols, "Resumen por año y mes");
  const encR = wr.addRow(["AÑO", ...MES3, "APORTES", "TOTAL AÑO"]);
  encR.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OSCURO } }; c.alignment = { horizontal: "center" }; });
  grupos.forEach((g) => {
    const meses = Array(12).fill(null);
    g.items.forEach((m) => { const k = new Date(m.fecha_pago).getMonth(); meses[k] = Math.round(((meses[k] || 0) + Number(m.monto || 0)) * 100) / 100; });
    const r = wr.addRow([g.anio, ...meses, g.items.length, g.total]);
    r.getCell(1).alignment = { horizontal: "center" };
    for (let i = 2; i <= 13; i += 1) r.getCell(i).numFmt = "#,##0.00";
    r.getCell(14).alignment = { horizontal: "center" };
    r.getCell(15).numFmt = MONEDA; r.getCell(15).font = { bold: true };
  });
  const totR = wr.addRow(["TOTAL", ...Array(12).fill(null), movimientos.length, total]);
  totR.eachCell((c) => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLARO } }; });
  totR.getCell(14).alignment = { horizontal: "center" };
  totR.getCell(15).numFmt = MONEDA;

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), filename: `aportaciones_${empleado.codigo || idAportacion}.xlsx` };
};

const pdfEstadoAportaciones = async (idAportacion, opciones = {}, user) => {
  const { empleado, movimientos } = await getEstadoAportaciones(idAportacion);
  const total = sumar(movimientos, "monto");
  const detalle = String(opciones.formato || "").toLowerCase() === "detalle";

  const doc = pdf.nuevoDoc(detalle ? pdf.CARTA : { size: "LETTER", layout: "landscape", margin: 36 });
  const cabecera = (d) => pdf.encabezado(d, {
    titulo: "ESTADO DE CUENTA DE APORTACIONES",
    subtitulo: detalle ? "Detalle de aportes" : "Resumen por año y mes"
  });
  cabecera(doc);

  // Ficha del empleado.
  const ancho = pdf.anchoUtil(doc);
  const media = ancho / 2;
  const x0 = doc.page.margins.left;
  const par = (etiqueta, valor, x, y, anchoTotal) => {
    const anchoEtiqueta = Math.min(110, anchoTotal * 0.45);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(etiqueta, x, y, { width: anchoEtiqueta, lineBreak: false });
    doc.font("Helvetica").fontSize(8).text(String(valor ?? "—"), x + anchoEtiqueta + 4, y,
      { width: anchoTotal - anchoEtiqueta - 4, lineBreak: false, ellipsis: true });
  };
  const primero = movimientos[0]?.fecha_pago; const ultimo = movimientos[movimientos.length - 1]?.fecha_pago;
  // El nombre va solo en su renglón: en media columna un nombre largo se montaba.
  let y = doc.y;
  par("NOMBRE:", empleado.nombre || "—", x0, y, ancho);
  y += 13;
  par("CODIGO:", empleado.codigo ?? "—", x0, y, media - 8);
  par("ESTADO:", empleado.estado || "—", x0 + media, y, media);
  y += 13;
  par("AREA / GERENCIA:", empleado.area || "—", x0, y, media - 8);
  par("PERIODO:", primero ? `${fecha(primero)} al ${fecha(ultimo)}` : "—", x0 + media, y, media);
  y += 13;
  par("TOTAL APORTADO:", `Q ${q(total)}`, x0, y, media - 8);
  par("CANTIDAD DE APORTES:", String(movimientos.length), x0 + media, y, media);
  y += 13;
  doc.y = y + 12;
  doc.x = x0;

  if (!movimientos.length) {
    doc.font("Helvetica-Oblique").fontSize(8).text("El empleado no tiene aportaciones registradas.");
  } else if (!detalle) {
    // ---- Matriz año x mes ----
    const MES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
    const porAnio = new Map();
    movimientos.forEach((m) => {
      const d = new Date(m.fecha_pago);
      const anio = d.getFullYear(); const mes = d.getMonth();
      if (!porAnio.has(anio)) porAnio.set(anio, { anio, meses: Array.from({ length: 12 }, () => ({ v: 0, n: 0 })), total: 0, n: 0 });
      const r = porAnio.get(anio);
      r.meses[mes].v += Number(m.monto || 0); r.meses[mes].n += 1;
      r.total += Number(m.monto || 0); r.n += 1;
    });
    const filas = [...porAnio.values()].sort((p1, p2) => p1.anio - p2.anio);
    let hayVarios = false;
    const celda = (c) => {
      if (!c.n) return "";
      if (c.n > 1) hayVarios = true;
      return `${q(c.v)}${c.n > 1 ? "*" : ""}`;
    };
    const anchos = pdf.repartirAnchos(doc, [5, ...Array(12).fill(6.4), 5.2, 8]);
    const columnas = [
      { titulo: "AÑO", campo: "anio", align: "center", ancho: anchos[0] },
      ...MES.map((t, i) => ({ titulo: t, campo: `m${i}`, align: "right", ancho: anchos[i + 1], valor: (f) => celda(f.meses[i]) })),
      { titulo: "APORTES", campo: "n", align: "center", ancho: anchos[13] },
      { titulo: "TOTAL AÑO", campo: "total", align: "right", ancho: anchos[14], valor: (f) => q(f.total) }
    ];
    // Filas más bajas cuando hay muchos años, para que quepa en una hoja.
    const espacio = doc.page.height - doc.page.margins.bottom - 30 - doc.y - 15 - 16 - 16;
    const alturaFila = Math.max(9.5, Math.min(13, espacio / filas.length));
    pdf.dibujarTabla(doc, columnas, filas, { fuente: alturaFila < 11 ? 6.6 : 7, alturaFila, altoEncabezado: 15, reservaInferior: 30, alRepetirEncabezado: cabecera });
    pdf.filaTotales(doc, columnas, { n: String(movimientos.length), total: q(total) }, "TOTAL GENERAL", 13, { fuente: 7.5 });
    if (hayVarios) {
      doc.moveDown(0.6);
      doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555555")
        .text("* Mes con más de un aporte: se muestra la suma del mes. El detalle de cada aporte está en el formato \"Detalle\".", x0);
      doc.fillColor("#000000");
    }
  } else {
    // ---- Detalle tipo calendario: bloques iguales por año (12 meses), 3 x 3 por hoja ----
    // Se lee por columnas: la primera tiene los 3 primeros años, la segunda los
    // 3 siguientes, etc. Un mes con varios aportes muestra la suma y (n).
    const MESES_C = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
    const COLS = 3; const FILAS = 3; const POR_HOJA = COLS * FILAS;
    const sepX = 14; const sepY = 10;
    const anchoCol = (ancho - sepX * (COLS - 1)) / COLS;
    const aMes = anchoCol * 0.20; const aFecha = anchoCol * 0.42; const aMonto = anchoCol - aMes - aFecha;
    const grupos = agruparPorAnio(movimientos);
    let hayVarios = false;

    for (let inicio = 0; inicio < grupos.length; inicio += POR_HOJA) {
      if (inicio > 0) { doc.addPage(); cabecera(doc); }
      const yIni = doc.y;
      const yFin = doc.page.height - doc.page.margins.bottom - 52;
      const altoBloque = (yFin - yIni - sepY * (FILAS - 1)) / FILAS;
      const altoBanda = 15; const altoTotal = 14;
      const altoFila = Math.min(13, (altoBloque - altoBanda - altoTotal) / 12);
      const fuente = altoFila < 10.5 ? 6.8 : 7.5;

      grupos.slice(inicio, inicio + POR_HOJA).forEach((g, i) => {
        const c = Math.floor(i / FILAS); const r = i % FILAS;
        const xb = x0 + c * (anchoCol + sepX);
        let yb = yIni + r * (altoBloque + sepY);
        // Banda del año
        doc.save().rect(xb, yb, anchoCol, altoBanda).fill("#1F4E5F").restore();
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF").text(String(g.anio), xb + 5, yb + 4, { width: anchoCol / 2 });
        doc.font("Helvetica").fontSize(7).text(`${g.items.length} aporte(s)`, xb + anchoCol / 2, yb + 4.5, { width: anchoCol / 2 - 5, align: "right" });
        yb += altoBanda;
        // Meses
        const porMes = Array.from({ length: 12 }, () => ({ v: 0, n: 0, ultima: null }));
        g.items.forEach((m) => {
          const d = new Date(m.fecha_pago); const k = d.getMonth();
          porMes[k].v = Math.round((porMes[k].v + Number(m.monto || 0)) * 100) / 100; porMes[k].n += 1; porMes[k].ultima = m.fecha_pago;
        });
        porMes.forEach((pm, k) => {
          const yy = yb + k * altoFila;
          if (k % 2 === 1) doc.save().rect(xb, yy, anchoCol, altoFila).fill("#F3F5F8").restore();
          const ty = yy + (altoFila - fuente) / 2;
          doc.font("Helvetica-Bold").fontSize(fuente).fillColor(pm.n ? "#1F4E5F" : "#9AA5B1").text(MESES_C[k], xb + 5, ty, { width: aMes - 5 });
          if (pm.n) {
            if (pm.n > 1) hayVarios = true;
            doc.font("Helvetica").fontSize(fuente).fillColor("#000000")
              .text(`${fecha(pm.ultima)}${pm.n > 1 ? ` (${pm.n})` : ""}`, xb + aMes, ty, { width: aFecha, align: "center" })
              .text(`Q ${q(pm.v)}`, xb + aMes + aFecha, ty, { width: aMonto - 5, align: "right" });
          } else {
            doc.font("Helvetica").fontSize(fuente).fillColor("#B0B8C1").text("—", xb + aMes, ty, { width: aFecha, align: "center" });
          }
        });
        yb += altoFila * 12;
        // Total del año
        doc.save().rect(xb, yb, anchoCol, altoTotal).fill("#DDE3EA").restore();
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000")
          .text(`TOTAL ${g.anio}`, xb + 5, yb + 3.5, { width: anchoCol / 2 })
          .text(`Q ${q(g.total)}`, xb + anchoCol / 2, yb + 3.5, { width: anchoCol / 2 - 5, align: "right" });
        doc.save().rect(xb, yIni + r * (altoBloque + sepY), anchoCol, altoBanda + altoFila * 12 + altoTotal).lineWidth(0.5).stroke("#C9D3DD").restore();
      });
      doc.y = yFin + 6;
    }

    // Total general y nota
    const yT = doc.y;
    doc.save().rect(x0, yT, ancho, 16).fill("#1F4E5F").restore();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF")
      .text(`TOTAL GENERAL (${movimientos.length} aportes)`, x0 + 6, yT + 4, { width: ancho / 2 })
      .text(`Q ${q(total)}`, x0 + ancho / 2, yT + 4, { width: ancho / 2 - 6, align: "right" });
    doc.fillColor("#000000");
    if (hayVarios) {
      doc.font("Helvetica-Oblique").fontSize(6.5).fillColor("#555555")
        .text("(n) = aportes en el mes; se muestra la fecha del último y la suma. El detalle de cada aporte está en el Excel.", x0, yT + 20, { width: ancho });
      doc.fillColor("#000000");
    }
    doc.y = yT + 30;
  }

  pdf.pieDePagina(doc, user?.usuario);
  logger.info("Impresión de estado de cuenta de aportaciones", { idAportacion, movimientos: movimientos.length, formato: detalle ? "detalle" : "anual", usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `aportaciones_${empleado.codigo || idAportacion}${detalle ? "_detalle" : ""}.pdf` };
};

// ---------------------------------------------------------------------------
// 17. Resumen por área y por concepto (carta vertical)
// ---------------------------------------------------------------------------
const getResumen = async ({ tipoManejo, desde, hasta }) => {
  const manejo = Number(tipoManejo);
  if (![1, 2].includes(manejo)) throw createError("El tipo de manejo debe ser 1 (régimen) o 2 (jubilados)");
  if (!desde || !hasta) throw createError("Debe indicar el rango de fechas de pago");

  const [[personas], [conceptos], mapaAreas] = await Promise.all([
    pool.query(sql("resumenPorPersona"), [manejo, desde, hasta]),
    pool.query(sql("resumenPorConcepto"), [manejo, desde, hasta]),
    manejo === 1 ? getMapaAreas() : Promise.resolve(new Map())
  ]);

  // Los jubilados no tienen puesto ni área: van todos bajo una sola etiqueta.
  const areaDe = (fila) => (manejo === 2
    ? "JUBILADOS"
    : (mapaAreas.get(Number(fila.id_empleado))?.area || SIN_AREA));

  const acumulado = new Map();
  personas.forEach((fila) => {
    const clave = areaDe(fila);
    if (!acumulado.has(clave)) acumulado.set(clave, { area: clave, personas: new Set(), nominal: 0, descuentos: 0 });
    const grupo = acumulado.get(clave);
    grupo.personas.add(Number(fila.persona));
    grupo.nominal += num(fila.nominal);
    grupo.descuentos += num(fila.descuentos);
  });

  const areas = [...acumulado.values()]
    .map((g) => ({
      area: g.area,
      personas: g.personas.size,
      nominal: g.nominal,
      descuentos: g.descuentos,
      liquido: g.nominal - g.descuentos
    }))
    .sort((a, b) => {
      if (a.area === SIN_AREA) return 1;
      if (b.area === SIN_AREA) return -1;
      return a.area.localeCompare(b.area);
    });

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

// ---------------------------------------------------------------------------
// Nómina de jubilados (oficio, agrupada por tipo de jubilación)
//
// NOTA sobre los descuentos: el formato impreso trae una columna "D. SEGURO"
// que aquí no se incluye, porque RPJ_CAT_TIPO_DESCUENTO no tiene un tipo de
// seguro (existe la bandera dat_aplica_seguro en datos de planilla, pero ningún
// SP genera ese renglón). Mientras no exista el tipo, la columna saldría en cero.
// ---------------------------------------------------------------------------
const getNominaJubilados = async (idPlanilla, opciones = {}) => {
  const planilla = await getPlanilla(idPlanilla);
  const [rows] = await pool.execute(sql("nominaJubilados"), [idPlanilla, idPlanilla]);
  const tipo = String(opciones.tipoJubilacion || "").trim().toUpperCase();
  const filas = tipo ? rows.filter((r) => String(r.tipo_jubilacion).toUpperCase() === tipo) : rows;
  return { planilla, filas, tipoJubilacion: tipo || null };
};

// Periodo AAAAMM + porcentaje -> "OCT 2023 50%".
const MES3 = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const periodoAplicado = (f) => {
  const p = String(f.periodo_aplicado || "");
  if (!p) return "";
  const mes = MES3[Number(p.slice(4, 6)) - 1];
  const texto = mes ? `${mes} ${p.slice(0, 4)}` : p;
  return `${texto} ${Number(f.pct_periodo || 0)}%`;
};

// Tamaño de letra de la tabla de la nómina de jubilados (puntos).
const LETRA_JUB = 7.5;

const COLS_JUBILADOS = (doc) => {
  const anchos = pdf.repartirAnchos(doc, [5, 24, 11, 8, 10, 8, 8, 8, 8, 8, 8, 11, 10]);
  const c = (titulo, campo, align, i, valor) => ({ titulo, campo, align, ancho: anchos[i], valor });
  return [
    c("COD", "codigo", "right", 0),
    c("NOMBRE", "nombre", "left", 1),
    c("PENSION", "tipo_jubilacion", "left", 2),
    c("FECHA", "fecha_jubilacion", "center", 3, (f) => fecha(f.fecha_jubilacion)),
    c("PENSION TOTAL", "pension_total", "right", 4, (f) => q(f.pension_total)),
    c("DESC. ASOC.", "desc_asociacion", "right", 5, (f) => q(f.desc_asociacion)),
    c("DESC. PREST.", "desc_prestamos", "right", 6, (f) => q(f.desc_prestamos)),
    c("D. JUDICIAL", "desc_judicial", "right", 7, (f) => q(f.desc_judicial)),
    c("D. BANRURAL", "desc_banrural", "right", 8, (f) => q(f.desc_banrural)),
    c("D. BANTRAB", "desc_bantrab", "right", 9, (f) => q(f.desc_bantrab)),
    // IGSS, ISR e INTECAP van juntos.
    c("OTROS DESC.", "desc_otros", "right", 10, (f) => q(f.desc_otros)),
    c("PERIODO APLICADO", "periodo_aplicado", "center", 11, periodoAplicado),
    c("LIQ. A RECIBIR", "liquido", "right", 12, (f) => q(f.liquido))
  ];
};

const totalesJubilados = (filas) => ({
  pension_total: q(sumar(filas, "pension_total")),
  desc_asociacion: q(sumar(filas, "desc_asociacion")),
  desc_prestamos: q(sumar(filas, "desc_prestamos")),
  desc_judicial: q(sumar(filas, "desc_judicial")),
  desc_banrural: q(sumar(filas, "desc_banrural")),
  desc_bantrab: q(sumar(filas, "desc_bantrab")),
  desc_otros: q(sumar(filas, "desc_otros")),
  liquido: q(sumar(filas, "liquido"))
});

// Agrupa por tipo de jubilación, dejando "SIN CLASIFICAR" de último.
const agruparPorTipoJubilacion = (filas) => {
  const mapa = new Map();
  filas.forEach((f) => {
    const clave = f.tipo_jubilacion || "SIN CLASIFICAR";
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(f);
  });
  return [...mapa.entries()].sort(([a], [b]) => {
    if (a === "SIN CLASIFICAR") return 1;
    if (b === "SIN CLASIFICAR") return -1;
    return a.localeCompare(b);
  });
};

const pdfNominaJubilados = async (idPlanilla, opciones = {}, user) => {
  const { planilla, filas, tipoJubilacion } = await getNominaJubilados(idPlanilla, opciones);
  if (!filas.length) {
    throw createError(
      tipoJubilacion
        ? `La planilla no tiene jubilados del tipo ${tipoJubilacion}`
        : "La planilla no tiene renglones de jubilados para imprimir",
      409
    );
  }

  const firmas = parsearFirmas(opciones.firmas);
  // Separar por tipo de jubilación es el modo normal; si ya se filtró por un
  // tipo concreto, agrupar no aporta nada.
  const porTipo = !tipoJubilacion && String(opciones.porTipo ?? "true") !== "false";
  const doc = pdf.nuevoDoc(pdf.OFICIO);
  const columnas = COLS_JUBILADOS(doc);

  const cabecera = (d) => pdf.encabezado(d, {
    titulo: "NOMINA DE JUBILADOS",
    subtitulo: `Planilla ${planilla.numero}   ·   Período ${fecha(planilla.fechaInicio)} al ${fecha(planilla.fechaFinal)}   ·   Pago ${fecha(planilla.fechaPago)}`,
    lineas: [tipoJubilacion ? `Tipo de jubilación: ${tipoJubilacion}` : null]
  });
  cabecera(doc);

  const grupos = porTipo ? agruparPorTipoJubilacion(filas) : [["", filas]];
  grupos.forEach(([tipo, filasTipo], idx) => {
    if (idx > 0) doc.moveDown(0.8);
    if (porTipo) {
      doc.font("Helvetica-Bold").fontSize(9).text(`PENSION: ${tipo}`);
      doc.moveDown(0.15);
    }
    pdf.dibujarTabla(doc, columnas, filasTipo, { fuente: LETRA_JUB, alturaFila: 13, altoEncabezado: 22, reservaInferior: 70, alRepetirEncabezado: cabecera });
    pdf.filaTotales(doc, columnas, totalesJubilados(filasTipo), porTipo ? `TOTAL ${tipo}` : "TOTAL DE PENSIONES", 2, { fuente: LETRA_JUB });
  });

  if (porTipo && grupos.length > 1) {
    doc.moveDown(0.4);
    pdf.filaTotales(doc, columnas, totalesJubilados(filas), "TOTAL DE PENSIONES", 2, { fuente: LETRA_JUB });
  }

  cierreNomina(doc, { total: sumar(filas, "liquido"), fechaPago: planilla.fechaPago, firmas });
  pdf.pieDePagina(doc, user?.usuario);

  logger.info("Impresión de nómina de jubilados", { idPlanilla, jubilados: filas.length, tipoJubilacion, usuario: user?.usuario });
  const sufijo = tipoJubilacion ? `_${tipoJubilacion.toLowerCase().replace(/\s+/g, "_")}` : "";
  return { buffer: await pdf.aBuffer(doc), filename: `nomina_jubilados_${planilla.numero}${sufijo}.pdf` };
};

// ---------------------------------------------------------------------------
// Resumen de nómina de jubilados (carta vertical): pensiones por tipo + remesas
// ---------------------------------------------------------------------------
const getResumenJubilados = async (idPlanilla, opciones = {}) => {
  const planilla = await getPlanilla(idPlanilla);
  const tipo = String(opciones.tipoJubilacion || "").trim().toUpperCase() || null;
  const [[pensionesTodas], [remesas]] = await Promise.all([
    pool.execute(sql("resumenJubiladosPensiones"), [idPlanilla, idPlanilla]),
    pool.execute(sql("resumenJubiladosRemesas"), [idPlanilla, tipo, tipo])
  ]);
  const pensiones = tipo ? pensionesTodas.filter((p) => String(p.tipo_jubilacion).toUpperCase() === tipo) : pensionesTodas;
  return { planilla, pensiones, remesas, tipoJubilacion: tipo };
};

const pdfResumenJubilados = async (idPlanilla, opciones = {}, user) => {
  const { planilla, pensiones, remesas, tipoJubilacion } = await getResumenJubilados(idPlanilla, opciones);
  if (tipoJubilacion && !pensiones.length) {
    throw createError(`La planilla no tiene jubilados del tipo ${tipoJubilacion}`, 409);
  }
  const firmas = parsearFirmas(opciones.firmas);
  const doc = pdf.nuevoDoc(pdf.CARTA);

  pdf.encabezado(doc, {
    titulo: "RESUMEN DE NOMINA DE JUBILADOS",
    area: tipoJubilacion ? `Tipo de jubilación: ${tipoJubilacion}` : null,
    subtitulo: `Planilla ${planilla.numero}   ·   Período ${fecha(planilla.fechaInicio)} al ${fecha(planilla.fechaFinal)}`,
    lineas: [`Pago ${fecha(planilla.fechaPago)}   ·   Generado por ${user?.usuario || "sistema"}`]
  });

  // Bloque PENSIONES: nominal y líquido por tipo de jubilación.
  doc.font("Helvetica-Bold").fontSize(9).text("PENSIONES");
  doc.moveDown(0.2);
  const anchosP = pdf.repartirAnchos(doc, [38, 14, 24, 24]);
  const colsPensiones = [
    { titulo: "TIPO DE JUBILACION", campo: "tipo_jubilacion", align: "left", ancho: anchosP[0] },
    { titulo: "CANT.", campo: "cantidad", align: "right", ancho: anchosP[1] },
    { titulo: "NOMINAL", campo: "nominal", align: "right", ancho: anchosP[2], valor: (f) => `Q ${q(f.nominal)}` },
    { titulo: "LIQ. A RECIBIR", campo: "liquido", align: "right", ancho: anchosP[3], valor: (f) => `Q ${q(f.liquido)}` }
  ];
  if (pensiones.length) {
    pdf.dibujarTabla(doc, colsPensiones, pensiones, { fuente: 8, alturaFila: 14 });
    pdf.filaTotales(doc, colsPensiones, {
      cantidad: String(pensiones.reduce((s, p) => s + num(p.cantidad), 0)),
      nominal: `Q ${q(sumar(pensiones, "nominal"))}`,
      liquido: `Q ${q(sumar(pensiones, "liquido"))}`
    }, "TOTAL", 1);
  } else {
    doc.font("Helvetica-Oblique").fontSize(8).text("La planilla no tiene pensiones generadas.");
  }

  // Bloque REMESAS: a dónde se traslada lo descontado.
  doc.moveDown(1);
  doc.x = doc.page.margins.left;
  doc.font("Helvetica-Bold").fontSize(9).text("REMESAS");
  doc.moveDown(0.2);
  const anchosR = pdf.repartirAnchos(doc, [52, 16, 32]);
  const colsRemesas = [
    { titulo: "CONCEPTO", campo: "concepto", align: "left", ancho: anchosR[0] },
    { titulo: "CANT.", campo: "cantidad", align: "right", ancho: anchosR[1] },
    { titulo: "MONTO", campo: "monto", align: "right", ancho: anchosR[2], valor: (f) => `Q ${q(f.monto)}` }
  ];
  if (remesas.length) {
    pdf.dibujarTabla(doc, colsRemesas, remesas, { fuente: 8, alturaFila: 14 });
    pdf.filaTotales(doc, colsRemesas, { monto: `Q ${q(sumar(remesas, "monto"))}` }, "TOTAL", 1);
  } else {
    doc.font("Helvetica-Oblique").fontSize(8).text("La planilla no tiene descuentos generados.");
  }

  // Lo que sale de caja: el líquido que reciben los jubilados más las remesas.
  doc.moveDown(1);
  doc.x = doc.page.margins.left;
  const granTotal = sumar(pensiones, "liquido") + sumar(remesas, "monto");
  doc.font("Helvetica-Bold").fontSize(9).text(`TOTAL GENERAL: Q ${q(granTotal)}`, { align: "right" });

  pdf.bloqueFirmas(doc, firmas);
  pdf.pieDePagina(doc, user?.usuario);
  logger.info("Impresión de resumen de nómina de jubilados", { idPlanilla, usuario: user?.usuario });
  return { buffer: await pdf.aBuffer(doc), filename: `resumen_nomina_jubilados_${planilla.numero}${tipoJubilacion ? "_" + tipoJubilacion.toLowerCase().replace(/s+/g, "_") : ""}.pdf` };
};

// Listas para los parámetros de las pantallas de impresión (áreas y tipos de
// jubilación). Van aquí y no en /catalogos porque ese endpoint no es para todos los roles.
const getOpciones = async () => {
  const leer = async (consulta) => {
    try { const [rows] = await pool.execute(consulta); return rows; } catch (error) {
      logger.warn("No se pudo leer un catálogo de opciones de impresión", { code: error.code, message: error.message });
      return [];
    }
  };
  const [areas, tipos] = await Promise.all([
    leer("SELECT are_descripcion AS nombre FROM RPJ_CAT_AREA ORDER BY are_descripcion"),
    leer("SELECT tju_id AS id, tju_descripcion AS nombre FROM RPJ_CAT_TIPO_JUBILACION ORDER BY tju_id")
  ]);
  return {
    areas: [...areas.map((a) => a.nombre), SIN_AREA],
    tiposJubilacion: tipos.map((t) => ({ id: t.id, nombre: t.nombre }))
  };
};

// ---------------------------------------------------------------------------
// Nómina de jubilados en Excel: mismo formato que el PDF (encabezado, grupos por
// tipo de jubilación, mismas columnas, subtotales, total y monto en letras).
// ---------------------------------------------------------------------------
const excelNominaJubilados = async (idPlanilla, opciones = {}) => {
  const ExcelJS = require("exceljs");
  const { planilla, filas, tipoJubilacion } = await getNominaJubilados(idPlanilla, opciones);
  if (!filas.length) throw createError("La planilla no tiene renglones de jubilados para exportar", 409);

  const columnas = [
    { titulo: "COD", campo: "codigo", ancho: 8 },
    { titulo: "NOMBRE", campo: "nombre", ancho: 38 },
    { titulo: "PENSION", campo: "tipo_jubilacion", ancho: 22 },
    { titulo: "FECHA", campo: "fecha_jubilacion", ancho: 12, fecha: true },
    { titulo: "PENSION TOTAL", campo: "pension_total", ancho: 15, monto: true },
    { titulo: "DESC. ASOC.", campo: "desc_asociacion", ancho: 12, monto: true },
    { titulo: "DESC. PREST.", campo: "desc_prestamos", ancho: 12, monto: true },
    { titulo: "D. JUDICIAL", campo: "desc_judicial", ancho: 12, monto: true },
    { titulo: "D. BANRURAL", campo: "desc_banrural", ancho: 12, monto: true },
    { titulo: "D. BANTRAB", campo: "desc_bantrab", ancho: 12, monto: true },
    { titulo: "OTROS DESC.", campo: "desc_otros", ancho: 12, monto: true },
    { titulo: "PERIODO APLICADO", campo: "periodo", ancho: 17 },
    { titulo: "LIQ. A RECIBIR", campo: "liquido", ancho: 15, monto: true }
  ];
  const n = columnas.length;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Nomina Jubilados", { pageSetup: { paperSize: 5, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  columnas.forEach((c, k) => { ws.getColumn(k + 1).width = c.ancho; });

  const titulo = (texto, tam, negrita = true) => {
    const r = ws.addRow([texto]);
    ws.mergeCells(r.number, 1, r.number, n);
    r.getCell(1).font = { bold: negrita, size: tam };
    r.getCell(1).alignment = { horizontal: "center" };
  };
  titulo("REGIMEN DE PENSIONES Y JUBILACIONES", 13);
  titulo("DEL PERSONAL DE LA EMPRESA PORTUARIA QUETZAL", 11);
  titulo("NOMINA DE JUBILADOS", 11);
  titulo(`Planilla ${planilla.numero}  ·  Período ${fecha(planilla.fechaInicio)} al ${fecha(planilla.fechaFinal)}  ·  Pago ${fecha(planilla.fechaPago)}`, 9, false);
  if (tipoJubilacion) titulo(`Tipo de jubilación: ${tipoJubilacion}`, 9, false);
  ws.addRow([]);

  const FORMATO = "#,##0.00";
  const pintar = (r, argb, fuenteBlanca) => r.eachCell({ includeEmpty: true }, (cell, k) => {
    if (k > n) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.font = { bold: true, color: { argb: fuenteBlanca ? "FFFFFFFF" : "FF000000" }, size: 9 };
  });
  const encabezadoTabla = () => {
    const r = ws.addRow(columnas.map((c) => c.titulo));
    pintar(r, "FF1F4E5F", true);
    r.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    r.height = 28;
  };
  const filaTotal = (etiqueta, lista) => {
    const valores = columnas.map((c) => (c.monto ? lista.reduce((s, f) => s + Number(f[c.campo] || 0), 0) : null));
    valores[0] = etiqueta;
    const r = ws.addRow(valores);
    ws.mergeCells(r.number, 1, r.number, 4);
    pintar(r, "FFDDE3EA");
    columnas.forEach((c, k) => { if (c.monto) r.getCell(k + 1).numFmt = FORMATO; });
  };

  const porTipo = !tipoJubilacion && String(opciones.porTipo ?? "true") !== "false";
  const grupos = porTipo ? agruparPorTipoJubilacion(filas) : [["", filas]];
  grupos.forEach(([tipo, lista], idx) => {
    if (idx > 0) ws.addRow([]);
    if (porTipo) { const r = ws.addRow([`PENSION: ${tipo}`]); r.getCell(1).font = { bold: true, size: 10 }; }
    encabezadoTabla();
    lista.forEach((f, k) => {
      const r = ws.addRow(columnas.map((c) => {
        if (c.campo === "periodo") return periodoAplicado(f);
        if (c.fecha) return f[c.campo] ? fecha(f[c.campo]) : "";
        return c.monto ? Number(f[c.campo] || 0) : f[c.campo];
      }));
      r.font = { size: 9 };
      columnas.forEach((c, j) => {
        if (c.monto) r.getCell(j + 1).numFmt = FORMATO;
        if (c.fecha || c.campo === "periodo") r.getCell(j + 1).alignment = { horizontal: "center" };
      });
      if (k % 2 === 1) r.eachCell({ includeEmpty: true }, (cell, j) => { if (j <= n) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6F8" } }; });
    });
    filaTotal(porTipo ? `TOTAL ${tipo}` : "TOTAL DE PENSIONES", lista);
  });
  if (porTipo && grupos.length > 1) { ws.addRow([]); filaTotal("TOTAL DE PENSIONES", filas); }

  ws.addRow([]);
  const total = sumar(filas, "liquido");
  const letras = ws.addRow([`LA PRESENTE PLANILLA ASCIENDE A LA CANTIDAD DE ${numeroALetras(total)}`]);
  ws.mergeCells(letras.number, 1, letras.number, n);
  letras.getCell(1).font = { size: 9 };
  const lugar = ws.addRow([`PUERTO QUETZAL, ${fechaLarga(planilla.fechaPago)}`]);
  ws.mergeCells(lugar.number, 1, lugar.number, n);
  lugar.getCell(1).font = { size: 9 };

  return { buffer: await wb.xlsx.writeBuffer(), filename: `nomina_jubilados_${planilla.numero}.xlsx` };
};

module.exports = {
  getOpciones,
  getNominaJubilados,
  pdfNominaJubilados,
  excelNominaJubilados,
  getResumenJubilados,
  pdfResumenJubilados,
  getEstadoAportaciones,
  pdfEstadoAportaciones,
  excelEstadoAportaciones,
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
