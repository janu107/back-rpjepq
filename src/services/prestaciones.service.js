const ExcelJS = require("exceljs");
const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

// Módulo de Prestaciones: Bono 14 (planilla tipo 5), Aguinaldo (tipo 7) y
// Bono Vacacional (tipo 9). Toda la lógica de cálculo vive en los SP
// sp_generar_* / sp_revertir_* / sp_*_prestacion; aquí sólo se listan y crean
// planillas, se invocan los SP y se consultan detalles.
//
// Ninguna de las 3 prestaciones lleva descuentos (exentas de IGSS/ISR por ley),
// por eso no se consulta RPJ_PRC_NOMINA_DESCUENTO en ningún query del módulo.

const sql = (file) => getSql(`prestaciones/${file}.sql`);
const num = (v) => Number(v || 0);

const PRESTACIONES = {
  bono14: {
    key: "bono14",
    tipoPlanilla: 5,
    nombre: "BONO 14",
    spGenerar: "sp_generar_bono14",
    spRevertir: "sp_revertir_bono14"
  },
  aguinaldo: {
    key: "aguinaldo",
    tipoPlanilla: 7,
    nombre: "AGUINALDO",
    spGenerar: "sp_generar_aguinaldo",
    spRevertir: "sp_revertir_aguinaldo"
  },
  vacacional: {
    key: "vacacional",
    tipoPlanilla: 9,
    nombre: "BONO VACACIONAL",
    spGenerar: "sp_generar_bono_vacacional",
    spRevertir: "sp_revertir_bono_vacacional"
  }
};

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const getTipo = (tipo) => {
  const config = PRESTACIONES[String(tipo || "").toLowerCase()];
  if (!config) throw createError("Tipo de prestación inválido. Use bono14, aguinaldo o vacacional.", 404);
  return config;
};

// Nombre legible a partir del id numérico de tipo de planilla (5/7/9). No se usa
// RPJ_CAT_TIPO_PLANILLA.tpl_tipo_planilla para esto: en producción esa columna
// guarda una bandera ("1"), no el nombre — el nombre real está en tpl_descripcion,
// y su formato varía por ambiente. Usar el nombre fijo del módulo es más robusto.
const NOMBRE_POR_TIPO = Object.fromEntries(
  Object.values(PRESTACIONES).map((c) => [c.tipoPlanilla, c.nombre])
);
const nombreDeTipo = (tipoPlanilla) => NOMBRE_POR_TIPO[Number(tipoPlanilla)] || null;

// Períodos legales. Bono 14: 01/07/(año-1) al 30/06/(año) (Decreto 42-92).
// Aguinaldo: 01/12/(año-1) al 30/11/(año) (Decreto 76-78). El SP recalcula el
// período internamente; esto es sólo para la pantalla y la validación previa.
const periodoDe = (tipo, anio) => {
  const y = Number(anio);
  if (tipo === "bono14") return { inicio: `${y - 1}-07-01`, fin: `${y}-06-30` };
  if (tipo === "aguinaldo") return { inicio: `${y - 1}-12-01`, fin: `${y}-11-30` };
  return null;
};

const mapPlanilla = (r) => ({
  id: r.id,
  tipoPlanilla: r.tipo_planilla,
  tipoPlanillaNombre: nombreDeTipo(r.tipo_planilla) || r.tipo_planilla_nombre,
  numero: r.numero,
  fechaInicio: r.fecha_inicio,
  fechaFinal: r.fecha_final,
  fechaPago: r.fecha_pago,
  estadoProceso: r.estado_proceso || "ABIERTA",
  fechaGeneracion: r.fecha_generacion,
  usuarioGenera: r.usuario_genera,
  porcentajePago: num(r.porcentaje_pago),
  totalEmpleados: num(r.total_empleados),
  totalPagado: num(r.total_pagado)
});

const mapDetalle = (r) => ({
  idLinea: r.id_linea,
  idEmpleado: r.id_empleado,
  dpi: r.dpi,
  nombreCompleto: r.nombre_completo,
  fechaIngreso: r.fecha_ingreso,
  puesto: r.puesto,
  dias: num(r.dias),
  salarioBase: num(r.salario_base),
  porcentaje: num(r.porcentaje),
  monto: num(r.monto),
  usuario: r.usuario,
  fecha: r.fecha
});

const list = async (tipo) => {
  const { tipoPlanilla } = getTipo(tipo);
  const [rows] = await pool.execute(sql("listar"), [tipoPlanilla, tipoPlanilla]);
  return rows.map(mapPlanilla);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Planilla no encontrada", 404);
  return mapPlanilla(rows[0]);
};

// Igual que getById pero exigiendo que la planilla sea del tipo de prestación
// indicado, para que /prestaciones/bono14/... no toque una planilla de aguinaldo.
const getByIdDelTipo = async (tipo, id) => {
  const { tipoPlanilla, nombre } = getTipo(tipo);
  const planilla = await getById(id);
  if (planilla.tipoPlanilla !== tipoPlanilla) {
    throw createError(`La planilla ${id} no es de ${nombre}.`, 409);
  }
  return planilla;
};

const validate = (d) => {
  if (!d.numero || String(d.numero).length !== 6) throw createError("El número de planilla debe tener formato YYYYMM");
  if (!d.fechaInicio || !d.fechaFinal || !d.fechaPago) throw createError("Las fechas son obligatorias");
  if (d.fechaInicio > d.fechaFinal) throw createError("La fecha inicio no puede ser mayor a la final");
  if (d.fechaFinal > d.fechaPago) throw createError("La fecha final no puede ser mayor a la fecha de pago");
};

const create = async (tipo, payload, currentUser) => {
  const { tipoPlanilla, nombre } = getTipo(tipo);
  validate(payload);

  const [dup] = await pool.execute(
    "SELECT ppl_correlativo FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = ? AND ppl_numero = ?",
    [tipoPlanilla, payload.numero]
  );
  if (dup.length) throw createError(`YA EXISTE UNA PLANILLA DE ${nombre} CON ESE NUMERO`, 409);

  const usuario = currentUser?.usuario || "sistema";
  const [res] = await pool.execute(sql("crear"), [
    tipoPlanilla, payload.numero, payload.fechaInicio, payload.fechaFinal, payload.fechaPago, usuario
  ]);
  return getById(res.insertId);
};

// CALL con variables de sesión en una sola conexión (los SP devuelven OUT).
const callSp = async (spCall, inParams, outNames) => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CALL ${spCall}`, inParams);
    const outSelect = outNames.map((n) => `@${n} AS ${n}`).join(", ");
    const [[outRow]] = await conn.query(`SELECT ${outSelect}`);
    return outRow;
  } finally {
    conn.release();
  }
};

// Los SP no lanzan SIGNAL: devuelven el error dentro de p_resultado.
const assertOk = (resultado) => {
  if (String(resultado || "").toUpperCase().includes("ERROR")) {
    throw createError(resultado || "El proceso no devolvió resultado.", 409);
  }
};

const generar = async (tipo, payload, currentUser) => {
  const config = getTipo(tipo);
  const idPlanilla = Number(payload?.idPlanilla);
  if (!idPlanilla) throw createError("Debe indicar la planilla a generar");

  await getByIdDelTipo(tipo, idPlanilla);
  const usuario = currentUser?.usuario || "sistema";

  if (config.key === "vacacional") {
    const porcentaje = Number(payload?.porcentaje);
    if (!porcentaje || porcentaje < 0.01 || porcentaje > 100) {
      throw createError("El porcentaje debe estar entre 0.01 y 100.00");
    }
    // El acta de autorización es requisito de trazabilidad de la junta directiva.
    if (!payload?.acta || String(payload.acta).trim() === "") {
      throw createError("El número de acta de autorización es obligatorio");
    }

    logger.info("Generando bono vacacional", { idPlanilla, porcentaje, acta: payload.acta, usuario });
    const out = await callSp(
      `${config.spGenerar}(?, ?, ?, @p_procesados, @p_excluidos, @p_total, @p_resultado)`,
      [idPlanilla, porcentaje, usuario],
      ["p_procesados", "p_excluidos", "p_total", "p_resultado"]
    );
    assertOk(out.p_resultado);
    return {
      resultado: out.p_resultado,
      procesados: num(out.p_procesados),
      excluidos: num(out.p_excluidos),
      totalPagado: num(out.p_total),
      planilla: await getById(idPlanilla)
    };
  }

  const anio = Number(payload?.anio);
  if (!anio || anio < 1900 || anio > 2999) throw createError("El año es obligatorio y debe ser válido");

  logger.info(`Generando ${config.nombre}`, { idPlanilla, anio, usuario });
  const out = await callSp(
    `${config.spGenerar}(?, ?, ?, @p_procesados, @p_total, @p_resultado)`,
    [idPlanilla, anio, usuario],
    ["p_procesados", "p_total", "p_resultado"]
  );
  assertOk(out.p_resultado);
  return {
    resultado: out.p_resultado,
    procesados: num(out.p_procesados),
    excluidos: 0,
    totalPagado: num(out.p_total),
    planilla: await getById(idPlanilla)
  };
};

const revertir = async (tipo, id, motivo, currentUser) => {
  const config = getTipo(tipo);
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo de la reversión es obligatorio");

  await getByIdDelTipo(tipo, id);
  const usuario = currentUser?.usuario || "sistema";

  logger.info(`Revirtiendo ${config.nombre}`, { idPlanilla: id, motivo, usuario });
  const out = await callSp(
    `${config.spRevertir}(?, ?, ?, @p_resultado)`,
    [id, usuario, motivo],
    ["p_resultado"]
  );
  assertOk(out.p_resultado);
  return { resultado: out.p_resultado, planilla: await getById(id) };
};

const getDetalle = async (id) => {
  const [rows] = await pool.execute(sql("detalle"), [id]);
  return rows.map(mapDetalle);
};

const editarMonto = async (idLinea, monto, currentUser) => {
  const nuevo = Number(monto);
  if (!nuevo || nuevo <= 0) throw createError("El monto debe ser mayor a cero");
  const usuario = currentUser?.usuario || "sistema";

  const out = await callSp(
    "sp_editar_monto_prestacion(?, ?, ?, @p_resultado)",
    [idLinea, nuevo, usuario],
    ["p_resultado"]
  );
  assertOk(out.p_resultado);
  return { resultado: out.p_resultado };
};

const agregarEmpleado = async (idPlanilla, payload, currentUser) => {
  const idEmpleado = Number(payload?.idEmpleado);
  const monto = Number(payload?.monto);
  const dias = Number(payload?.dias || 0);
  if (!idEmpleado) throw createError("Debe seleccionar un empleado");
  if (!monto || monto <= 0) throw createError("El monto debe ser mayor a cero");

  const usuario = currentUser?.usuario || "sistema";
  const out = await callSp(
    "sp_agregar_empleado_prestacion(?, ?, ?, ?, ?, @p_resultado)",
    [idPlanilla, idEmpleado, monto, dias, usuario],
    ["p_resultado"]
  );
  assertOk(out.p_resultado);
  return { resultado: out.p_resultado };
};

const eliminarLinea = async (idLinea, motivo, currentUser) => {
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo es obligatorio");
  const usuario = currentUser?.usuario || "sistema";

  const out = await callSp(
    "sp_eliminar_linea_prestacion(?, ?, ?, @p_resultado)",
    [idLinea, usuario, motivo],
    ["p_resultado"]
  );
  assertOk(out.p_resultado);
  return { resultado: out.p_resultado };
};

const getEmpleadosDisponibles = async (idPlanilla) => {
  const [rows] = await pool.execute(sql("empleadosDisponibles"), [idPlanilla]);
  return rows.map((r) => ({
    idEmpleado: r.id_empleado,
    dpi: r.dpi,
    nombreCompleto: r.nombre_completo,
    puesto: r.puesto,
    fechaIngreso: r.fecha_ingreso,
    salario: num(r.salario)
  }));
};

// Previsualización: cuántos empleados y cuánto se pagará si se genera ahora.
const preview = async (tipo, query) => {
  const config = getTipo(tipo);

  if (config.key === "vacacional") {
    const porcentaje = Number(query?.porcentaje || 100);
    if (porcentaje < 0.01 || porcentaje > 100) throw createError("El porcentaje debe estar entre 0.01 y 100.00");
    const fechaCorte = query?.fechaCorte || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.execute(sql("previewVacacional"), [porcentaje, fechaCorte, fechaCorte]);
    const r = rows[0] || {};
    return {
      tipo: config.key,
      fechaCorte,
      porcentaje,
      totalEmpleados: num(r.total_empleados),
      totalExcluidos: num(r.total_excluidos),
      totalEstimado: num(r.total_estimado)
    };
  }

  const anio = Number(query?.anio) || new Date().getFullYear();
  const { inicio, fin } = periodoDe(config.key, anio);
  const [rows] = await pool.execute(sql("previewPeriodo"), [fin, inicio, inicio, inicio, fin]);
  const r = rows[0] || {};
  return {
    tipo: config.key,
    anio,
    periodoInicio: inicio,
    periodoFin: fin,
    totalEmpleados: num(r.total_empleados),
    totalExcluidos: 0,
    totalEstimado: num(r.total_estimado)
  };
};

const getExcluidosVacacional = async (query) => {
  const fechaCorte = query?.fechaCorte || new Date().toISOString().slice(0, 10);
  const [rows] = await pool.execute(sql("excluidosVacacional"), [fechaCorte, fechaCorte, fechaCorte, fechaCorte]);
  return rows.map((r) => ({
    idEmpleado: r.id_empleado,
    dpi: r.dpi,
    nombreCompleto: r.nombre_completo,
    puesto: r.puesto,
    fechaIngreso: r.fecha_ingreso,
    diasAntiguedad: num(r.dias_antiguedad),
    anios: num(r.anios)
  }));
};

const getResumenAnual = async () => {
  const [rows] = await pool.execute(sql("resumenAnual"));
  return rows.map((r) => ({
    anio: r.anio,
    tipoPlanilla: r.tipo_planilla,
    prestacion: r.prestacion,
    empleados: num(r.empleados),
    totalPagado: num(r.total_pagado)
  }));
};

const exportExcel = async (id) => {
  const [planilla, detalle] = await Promise.all([getById(id), getDetalle(id)]);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(planilla.tipoPlanillaNombre || "Prestacion");

  ws.columns = [
    { header: "DPI",             key: "dpi",            width: 16 },
    { header: "Nombre Completo", key: "nombreCompleto", width: 32 },
    { header: "Puesto",          key: "puesto",         width: 22 },
    { header: "Días",            key: "dias",           width: 10 },
    { header: "Salario Base",    key: "salarioBase",    width: 16 },
    { header: "%",               key: "porcentaje",     width: 8 },
    { header: "Monto",           key: "monto",          width: 16 }
  ];

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E5F" } };

  detalle.forEach((r) => ws.addRow(r));

  const tot = ws.addRow({
    nombreCompleto: "TOTAL",
    monto: detalle.reduce((s, r) => s + num(r.monto), 0)
  });
  tot.font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const slug = String(planilla.tipoPlanillaNombre || "prestacion").toLowerCase().replace(/\s+/g, "_");
  return { buffer: buf, filename: `${slug}_${planilla.numero}.xlsx` };
};

const exportBanco = async (id) => {
  const [planilla, detalle] = await Promise.all([getById(id), getDetalle(id)]);
  const lines = detalle.map((r) => {
    const nombre = (r.nombreCompleto || "").substring(0, 40).padEnd(40);
    return `${r.dpi || ""}|${nombre}|${num(r.monto).toFixed(2)}`;
  });
  const slug = String(planilla.tipoPlanillaNombre || "prestacion").toLowerCase().replace(/\s+/g, "_");
  return { content: lines.join("\n"), filename: `banco_${slug}_${planilla.numero}.txt` };
};

const cerrar = async (id, currentUser) => {
  const planilla = await getById(id);
  if (planilla.estadoProceso !== "GENERADA") {
    throw createError(`No se puede cerrar una planilla en estado ${planilla.estadoProceso}`, 409);
  }
  const usuario = currentUser?.usuario || "sistema";
  const conn = await pool.getConnection();
  try {
    await conn.query("CALL sp_cerrar_planilla(?, ?)", [id, usuario]);
  } finally {
    conn.release();
  }
  return getById(id);
};

module.exports = {
  PRESTACIONES,
  list,
  getById,
  create,
  generar,
  revertir,
  getDetalle,
  editarMonto,
  agregarEmpleado,
  eliminarLinea,
  getEmpleadosDisponibles,
  preview,
  getExcluidosVacacional,
  getResumenAnual,
  exportExcel,
  exportBanco,
  cerrar
};
