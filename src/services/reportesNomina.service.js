const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const dayjs = require("dayjs");

const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const sql = (file) => getSql(`reportes/nomina/${file}.sql`);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const number = (value) => Number(value || 0);
const money = (value) => `Q ${number(value).toFixed(2)}`;
const date = (value) => (value ? dayjs(value).format("DD/MM/YYYY") : "");
const datetime = (value) => (value ? dayjs(value).format("DD/MM/YYYY HH:mm") : "");

const mapResumen = (row) => row && ({
  idPlanilla: row.id_planilla,
  numeroPlanilla: row.numero_planilla,
  idTipoPlanilla: row.id_tipo_planilla,
  tipoPlanilla: row.tpl_tipo_planilla,
  tipoPlanillaDescripcion: row.tipo_planilla_descripcion,
  fechaInicio: row.ppl_fecha_inicio,
  fechaFinal: row.ppl_fecha_final,
  fechaPago: row.ppl_fecha_pago,
  frecuencia: row.ppl_frecuencia,
  estado: row.ppl_estado,
  totalIngresos: number(row.total_ingresos),
  totalDescuentos: number(row.total_descuentos),
  liquido: number(row.liquido),
  cantidadIngresos: number(row.cantidad_ingresos),
  cantidadDescuentos: number(row.cantidad_descuentos),
  cantidadEmpleados: number(row.cantidad_empleados),
  cantidadJubilados: number(row.cantidad_jubilados)
});

const mapIngreso = (row) => ({
  id: row.nin_correlativo,
  tipoManejo: row.nin_tipo_manejo,
  manejoDescripcion: row.manejo_descripcion,
  idTipoPlanilla: row.nin_id_tipo_planilla,
  tipoPlanilla: row.tpl_tipo_planilla,
  tipoPlanillaDescripcion: row.tipo_planilla_descripcion,
  idPlanilla: row.nin_id_planilla,
  numeroPlanilla: row.numero_planilla,
  fechaInicio: row.ppl_fecha_inicio,
  fechaFinal: row.ppl_fecha_final,
  fechaPago: row.ppl_fecha_pago,
  idEmpleado: row.nin_id_empleado,
  idJubilado: row.nin_id_jubilado,
  persona: row.empleado_nombre || row.jubilado_nombre || "N/A",
  tipoPersona: row.nin_id_empleado ? "EMPLEADO" : "JUBILADO",
  tipoIngreso: row.nin_tipo_ingreso,
  tipoIngresoNombre: row.tin_tipo_ingreso,
  tipoIngresoDescripcion: row.tipo_ingreso_descripcion,
  valor: number(row.nin_valor),
  diasTrabajados: row.nin_dias_trabajados,
  puesto: row.nin_puesto,
  area: row.nin_area,
  fechaCreacion: row.nin_fecha_creacion
});

const mapDescuento = (row) => ({
  id: row.nde_correlativo,
  tipoManejo: row.nde_tipo_manejo,
  manejoDescripcion: row.manejo_descripcion,
  idTipoPlanilla: row.nde_id_tipo_planilla,
  tipoPlanilla: row.tpl_tipo_planilla,
  tipoPlanillaDescripcion: row.tipo_planilla_descripcion,
  idPlanilla: row.nde_id_planilla,
  numeroPlanilla: row.numero_planilla,
  fechaInicio: row.ppl_fecha_inicio,
  fechaFinal: row.ppl_fecha_final,
  fechaPago: row.ppl_fecha_pago,
  idEmpleado: row.nde_id_empleado,
  idJubilado: row.nde_id_jubilado,
  persona: row.empleado_nombre || row.jubilado_nombre || "N/A",
  tipoPersona: row.nde_id_empleado ? "EMPLEADO" : "JUBILADO",
  tipoDescuento: row.nde_tipo_descuento,
  tipoDescuentoNombre: row.tde_tipo_descuento,
  tipoDescuentoDescripcion: row.tipo_descuento_descripcion,
  valor: number(row.nde_valor),
  diasTrabajados: row.nde_dias_trabajados,
  puesto: row.nde_puesto,
  area: row.nde_area,
  fechaCreacion: row.nde_fecha_creacion
});

const mapPlanillaListado = (row) => ({
  idPlanilla: row.id_planilla,
  numeroPlanilla: row.numero_planilla,
  idTipoPlanilla: row.id_tipo_planilla,
  tipoPlanilla: row.tpl_tipo_planilla,
  tipoPlanillaDescripcion: row.tipo_planilla_descripcion,
  fechaInicio: row.ppl_fecha_inicio,
  fechaFinal: row.ppl_fecha_final,
  fechaPago: row.ppl_fecha_pago,
  frecuencia: row.ppl_frecuencia,
  estado: row.ppl_estado,
  totalIngresos: number(row.total_ingresos),
  totalDescuentos: number(row.total_descuentos),
  liquido: number(row.liquido)
});

const getReportePlanilla = async (idPlanilla) => {
  if (!idPlanilla) throw createError("idPlanilla es obligatorio");
  logger.info("Consulta de reporte de planilla", { idPlanilla });

  const [[resumenRows], [ingresoRows], [descuentoRows]] = await Promise.all([
    pool.execute(sql("resumenPlanilla"), [idPlanilla]),
    pool.execute(sql("reportePlanillaIngresos"), [idPlanilla]),
    pool.execute(sql("reportePlanillaDescuentos"), [idPlanilla])
  ]);

  if (!resumenRows[0]) throw createError("La planilla no existe", 404);
  if (!ingresoRows.length && !descuentoRows.length) throw createError("La planilla no tiene registros generados.", 404);

  return {
    resumen: mapResumen(resumenRows[0]),
    ingresos: ingresoRows.map(mapIngreso),
    descuentos: descuentoRows.map(mapDescuento)
  };
};

const listarPlanillas = async () => {
  logger.info("Listado de planillas con resumen");
  const [rows] = await pool.execute(sql("listarPlanillasConResumen"));
  return rows.map(mapPlanillaListado);
};

const getReporteEmpleado = async (idEmpleado, idPlanilla = null) => {
  if (!idEmpleado) throw createError("idEmpleado es obligatorio");
  logger.info("Consulta de reporte por empleado", { idEmpleado, idPlanilla });
  const params = [idPlanilla, idPlanilla, idPlanilla, idPlanilla, idPlanilla, idEmpleado];
  const [rows] = await pool.execute(sql("resumenEmpleado"), params);
  return rows.map((row) => ({
    idEmpleado: row.id_empleado,
    empleadoNombre: row.empleado_nombre,
    dpi: row.emp_dpi,
    idPlanilla: row.id_planilla,
    numeroPlanilla: row.numero_planilla,
    tipoPlanilla: row.tpl_tipo_planilla,
    totalIngresos: number(row.total_ingresos),
    totalDescuentos: number(row.total_descuentos),
    liquido: number(row.liquido),
    cantidadIngresos: number(row.cantidad_ingresos),
    cantidadDescuentos: number(row.cantidad_descuentos)
  }));
};

const getReporteJubilado = async (idJubilado, idPlanilla = null) => {
  if (!idJubilado) throw createError("idJubilado es obligatorio");
  logger.info("Consulta de reporte por jubilado", { idJubilado, idPlanilla });
  const params = [idPlanilla, idPlanilla, idPlanilla, idPlanilla, idPlanilla, idJubilado];
  const [rows] = await pool.execute(sql("resumenJubilado"), params);
  return rows.map((row) => ({
    idJubilado: row.id_jubilado,
    jubiladoNombre: row.jubilado_nombre,
    dpi: row.jub_dpi,
    idPlanilla: row.id_planilla,
    numeroPlanilla: row.numero_planilla,
    tipoPlanilla: row.tpl_tipo_planilla,
    totalIngresos: number(row.total_ingresos),
    totalDescuentos: number(row.total_descuentos),
    liquido: number(row.liquido),
    cantidadIngresos: number(row.cantidad_ingresos),
    cantidadDescuentos: number(row.cantidad_descuentos)
  }));
};

const addWorksheet = (workbook, name, columns, rows) => {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));
  sheet.columns.forEach((column) => {
    column.width = column.width || 18;
  });
  return sheet;
};

const addResumenSheet = (workbook, resumen) => {
  const sheet = workbook.addWorksheet("Resumen");
  sheet.addRows([
    ["Reporte", "Reporte de Planilla RPJEPQ"],
    ["Numero de planilla", resumen.numeroPlanilla],
    ["Tipo planilla", `${resumen.tipoPlanilla || ""} ${resumen.tipoPlanillaDescripcion || ""}`.trim()],
    ["Fecha inicio", date(resumen.fechaInicio)],
    ["Fecha final", date(resumen.fechaFinal)],
    ["Fecha pago", date(resumen.fechaPago)],
    ["Estado", resumen.estado],
    ["Total ingresos", resumen.totalIngresos],
    ["Total descuentos", resumen.totalDescuentos],
    ["Liquido", resumen.liquido],
    ["Cantidad ingresos", resumen.cantidadIngresos],
    ["Cantidad descuentos", resumen.cantidadDescuentos],
    ["Cantidad empleados", resumen.cantidadEmpleados],
    ["Cantidad jubilados", resumen.cantidadJubilados]
  ]);
  sheet.getColumn(1).font = { bold: true };
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 32;
  [8, 9, 10].forEach((rowNumber) => {
    sheet.getCell(`B${rowNumber}`).numFmt = '"Q" #,##0.00';
  });
};

const ingresoColumns = [
  { header: "ID", key: "id", width: 10 },
  { header: "Tipo manejo", key: "manejoDescripcion", width: 22 },
  { header: "Tipo planilla", key: "tipoPlanilla", width: 18 },
  { header: "Numero planilla", key: "numeroPlanilla", width: 18 },
  { header: "Persona", key: "persona", width: 30 },
  { header: "Tipo persona", key: "tipoPersona", width: 16 },
  { header: "Tipo ingreso", key: "tipoIngresoNombre", width: 18 },
  { header: "Valor", key: "valor", width: 14, style: { numFmt: '"Q" #,##0.00' } },
  { header: "Dias trabajados", key: "diasTrabajados", width: 18 },
  { header: "Puesto", key: "puesto", width: 22 },
  { header: "Area", key: "area", width: 22 },
  { header: "Fecha creacion", key: "fechaCreacion", width: 20 }
];

const descuentoColumns = [
  { header: "ID", key: "id", width: 10 },
  { header: "Tipo manejo", key: "manejoDescripcion", width: 22 },
  { header: "Tipo planilla", key: "tipoPlanilla", width: 18 },
  { header: "Numero planilla", key: "numeroPlanilla", width: 18 },
  { header: "Persona", key: "persona", width: 30 },
  { header: "Tipo persona", key: "tipoPersona", width: 16 },
  { header: "Tipo descuento", key: "tipoDescuentoNombre", width: 18 },
  { header: "Valor", key: "valor", width: 14, style: { numFmt: '"Q" #,##0.00' } },
  { header: "Dias trabajados", key: "diasTrabajados", width: 18 },
  { header: "Puesto", key: "puesto", width: 22 },
  { header: "Area", key: "area", width: 22 },
  { header: "Fecha creacion", key: "fechaCreacion", width: 20 }
];

const exportarExcelPlanilla = async (idPlanilla) => {
  logger.info("Exportacion Excel de planilla", { idPlanilla });
  try {
    const reporte = await getReportePlanilla(idPlanilla);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RPJEPQ";
    workbook.created = new Date();
    addResumenSheet(workbook, reporte.resumen);
    addWorksheet(workbook, "Ingresos", ingresoColumns, reporte.ingresos.map((row) => ({ ...row, fechaCreacion: datetime(row.fechaCreacion) })));
    addWorksheet(workbook, "Descuentos", descuentoColumns, reporte.descuentos.map((row) => ({ ...row, fechaCreacion: datetime(row.fechaCreacion) })));
    return workbook.xlsx.writeBuffer();
  } catch (error) {
    logger.error("Error al generar Excel de planilla", { idPlanilla, message: error.message, code: error.code });
    throw error;
  }
};

const exportarIngresosExcel = async (idPlanilla) => {
  logger.info("Exportacion Excel de ingresos", { idPlanilla });
  const reporte = await getReportePlanilla(idPlanilla);
  const workbook = new ExcelJS.Workbook();
  addWorksheet(workbook, "Ingresos", ingresoColumns, reporte.ingresos.map((row) => ({ ...row, fechaCreacion: datetime(row.fechaCreacion) })));
  return workbook.xlsx.writeBuffer();
};

const exportarDescuentosExcel = async (idPlanilla) => {
  logger.info("Exportacion Excel de descuentos", { idPlanilla });
  const reporte = await getReportePlanilla(idPlanilla);
  const workbook = new ExcelJS.Workbook();
  addWorksheet(workbook, "Descuentos", descuentoColumns, reporte.descuentos.map((row) => ({ ...row, fechaCreacion: datetime(row.fechaCreacion) })));
  return workbook.xlsx.writeBuffer();
};

const drawTable = (doc, title, headers, rows, getValues) => {
  doc.moveDown().fontSize(12).font("Helvetica-Bold").text(title);
  doc.moveDown(0.4).fontSize(8).font("Helvetica-Bold");
  doc.text(headers.join(" | "));
  doc.moveDown(0.2).font("Helvetica");
  rows.forEach((row) => {
    if (doc.y > 720) doc.addPage();
    doc.text(getValues(row).join(" | "), { lineGap: 2 });
  });
};

const exportarPdfPlanilla = async (idPlanilla, user) => {
  logger.info("Exportacion PDF de planilla", { idPlanilla, user: user?.usuario });
  try {
    const reporte = await getReportePlanilla(idPlanilla);
    const doc = new PDFDocument({ size: "LETTER", margin: 36 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));

    doc.fontSize(16).font("Helvetica-Bold").text("RPJEPQ", { align: "center" });
    doc.fontSize(14).text("Reporte de Planilla", { align: "center" });
    doc.moveDown();
    doc.fontSize(9).font("Helvetica");
    doc.text(`Numero de planilla: ${reporte.resumen.numeroPlanilla}`);
    doc.text(`Tipo de planilla: ${reporte.resumen.tipoPlanilla || ""} ${reporte.resumen.tipoPlanillaDescripcion || ""}`);
    doc.text(`Rango de fechas: ${date(reporte.resumen.fechaInicio)} - ${date(reporte.resumen.fechaFinal)}`);
    doc.text(`Fecha de pago: ${date(reporte.resumen.fechaPago)}`);
    doc.text(`Estado: ${reporte.resumen.estado}`);
    doc.text(`Fecha de generacion: ${datetime(new Date())}`);

    doc.moveDown().fontSize(12).font("Helvetica-Bold").text("Resumen general");
    doc.fontSize(9).font("Helvetica");
    doc.text(`Total ingresos: ${money(reporte.resumen.totalIngresos)}`);
    doc.text(`Total descuentos: ${money(reporte.resumen.totalDescuentos)}`);
    doc.text(`Liquido a pagar: ${money(reporte.resumen.liquido)}`);
    doc.text(`Cantidad ingresos: ${reporte.resumen.cantidadIngresos}`);
    doc.text(`Cantidad descuentos: ${reporte.resumen.cantidadDescuentos}`);

    drawTable(doc, "Detalle de ingresos", ["Persona", "Tipo", "Ingreso", "Puesto", "Area", "Dias", "Valor"], reporte.ingresos, (row) => [
      row.persona, row.tipoPersona, row.tipoIngresoNombre || row.tipoIngresoDescripcion || row.tipoIngreso, row.puesto || "", row.area || "", row.diasTrabajados, money(row.valor)
    ]);

    drawTable(doc, "Detalle de descuentos", ["Persona", "Tipo", "Descuento", "Puesto", "Area", "Dias", "Valor"], reporte.descuentos, (row) => [
      row.persona, row.tipoPersona, row.tipoDescuentoNombre || row.tipoDescuentoDescripcion || row.tipoDescuento, row.puesto || "", row.area || "", row.diasTrabajados, money(row.valor)
    ]);

    doc.moveDown().fontSize(8).text(`Generado por: ${user?.usuario || "sistema"} - ${datetime(new Date())}`, { align: "right" });
    doc.end();

    return new Promise((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
  } catch (error) {
    logger.error("Error al generar PDF de planilla", { idPlanilla, message: error.message, code: error.code });
    throw error;
  }
};

module.exports = {
  getReportePlanilla,
  listarPlanillas,
  getReporteEmpleado,
  getReporteJubilado,
  exportarPdfPlanilla,
  exportarExcelPlanilla,
  exportarIngresosExcel,
  exportarDescuentosExcel
};
