const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const ExcelJS = require("exceljs");
const { assertCan, createError } = require("../utils/planillaEstado");

// CAMBIO X: las planillas de pensionados son SIEMPRE tipo 2 (NÓMINA JUBILADOS).
const TIPO_PLANILLA_PENSIONADOS = 2;

const sql = (file) => getSql(`planillas-pensionados/${file}.sql`);

const toNum = (v) => Number(v || 0);

const mapPlanilla = (row) => ({
  id: row.id,
  tipoPlanilla: row.tipo_planilla,
  tipoPlanillaNombre: row.tipo_planilla_nombre,
  tipoPlanillaDescripcion: row.tipo_planilla_descripcion,
  numero: row.numero,
  fechaInicio: row.fecha_inicio,
  fechaFinal: row.fecha_final,
  fechaPago: row.fecha_pago,
  frecuencia: row.frecuencia,
  estado: row.estado,
  aplicaPorcentaje: Boolean(row.aplica_porcentaje),
  porcentajePago: toNum(row.porcentaje_pago),
  estadoProceso: row.estado_proceso || "ABIERTA",
  fechaGeneracion: row.fecha_generacion,
  fechaCierre: row.fecha_cierre,
  usuarioGenera: row.usuario_genera,
  usuarioCierra: row.usuario_cierra,
  fechaCreacion: row.fecha_creacion,
  usuarioCreacion: row.usuario_creacion,
  totalJubilados: toNum(row.total_jubilados),
  totalIngresos: toNum(row.total_ingresos),
  totalDescuentos: toNum(row.total_descuentos),
  netoPagar: toNum(row.neto_a_pagar)
});

const mapDetalle = (row) => ({
  idJubilado: row.id_jubilado,
  dpi: row.dpi,
  nombreCompleto: row.nombre_completo,
  fechaJubilacion: row.fecha_jubilacion,
  pensionTeorica: toNum(row.pension_teorica),
  porcentajeAplicado: toNum(row.porcentaje_aplicado),
  pagoCorriente: toNum(row.pago_corriente),
  abonoHistorico: toNum(row.abono_historico),
  periodoAplicado: row.periodo_aplicado,
  totalIngreso: toNum(row.total_ingreso),
  totalDescuentos: toNum(row.total_descuentos),
  netoPagar: toNum(row.neto_a_pagar),
  estadoPlanilla: row.estado_planilla,
  cuentaBanco: row.cuenta_banco,
  formaPago: row.forma_pago,
  bancoNombre: row.banco_nombre
});

const validate = (data) => {
  // CAMBIO X: el tipo de planilla es fijo (NÓMINA JUBILADOS); no se exige del payload.
  if (!data.numero || String(data.numero).length !== 6) throw createError("El número de planilla debe tener formato YYYYMM");
  if (!data.fechaInicio) throw createError("La fecha de inicio es obligatoria");
  if (!data.fechaFinal) throw createError("La fecha final es obligatoria");
  if (!data.fechaPago) throw createError("La fecha de pago es obligatoria");
  if (data.fechaInicio > data.fechaFinal) throw createError("La fecha inicio no puede ser mayor a la fecha final");
  if (data.fechaFinal > data.fechaPago) throw createError("La fecha final no puede ser mayor a la fecha de pago");
  const pct = toNum(data.porcentajePago);
  if (pct <= 0 || pct > 100) throw createError("El porcentaje de pago debe estar entre 1 y 100");
};

const list = async () => {
  const [rows] = await pool.execute(sql("listar"));
  return rows.map(mapPlanilla);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Planilla no encontrada", 404);
  return mapPlanilla(rows[0]);
};

const create = async (payload, currentUser) => {
  validate(payload);
  // CAMBIO X: el tipo de planilla se fuerza a NÓMINA JUBILADOS (2), sin importar
  // lo que envíe el frontend.
  const tipoPlanilla = TIPO_PLANILLA_PENSIONADOS;
  // Evitar planillas duplicadas por tipo + numero (Version VII)
  const [dup] = await pool.execute(
    "SELECT ppl_correlativo FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = ? AND ppl_numero = ?",
    [tipoPlanilla, payload.numero]
  );
  if (dup.length) throw createError("YA EXISTE UNA PLANILLA DE PENSIONADOS CON ESE NUMERO", 409);
  const usuario = currentUser?.usuario || "sistema";
  const params = [
    tipoPlanilla, payload.numero,
    payload.fechaInicio, payload.fechaFinal, payload.fechaPago,
    toNum(payload.porcentajePago),
    usuario
  ];
  const [result] = await pool.execute(sql("crear"), params);
  return getById(result.insertId);
};

const update = async (id, payload, currentUser) => {
  const existing = await getById(id);
  if (existing.estadoProceso !== "ABIERTA") throw createError("Solo se pueden editar planillas en estado ABIERTA");
  const pct = toNum(payload.porcentajePago);
  if (pct <= 0 || pct > 100) throw createError("El porcentaje de pago debe estar entre 1 y 100");
  if (payload.fechaInicio > payload.fechaFinal) throw createError("La fecha inicio no puede ser mayor a la fecha final");
  if (payload.fechaFinal > payload.fechaPago) throw createError("La fecha final no puede ser mayor a la fecha de pago");
  await pool.execute(sql("actualizar"), [
    payload.numero, payload.fechaInicio, payload.fechaFinal, payload.fechaPago, pct, id
  ]);
  return getById(id);
};

// Motivo de exclusión de un jubilado (null = apto). El SP exige datos de
// planilla, aplica a nómina y salario inicial (sal_tipo_ingreso = 1).
const motivoExclusionJubilado = (j) => {
  if (!j.tiene_datos) return "SIN DATOS DE PLANILLA";
  if (!j.aplica_nomina) return "NO APLICA A NÓMINA";
  if (!j.tiene_salario) return "SIN PENSIÓN (SALARIO) CONFIGURADA";
  return null;
};

const mapJubiladoPreview = (j) => {
  const motivo = motivoExclusionJubilado(j);
  const apto = Boolean(j.tiene_datos) && Boolean(j.aplica_nomina) && Boolean(j.tiene_salario);
  return {
    idJubilado: j.id_jubilado,
    dpi: j.dpi,
    nombreCompleto: j.nombre_completo,
    fechaJubilacion: j.fecha_jubilacion,
    tieneDatos: Boolean(j.tiene_datos),
    aplicaNomina: Boolean(j.aplica_nomina),
    tieneSalario: Boolean(j.tiene_salario),
    salarioBase: toNum(j.salario_base),
    apto,
    motivo: apto ? null : motivo
  };
};

const preview = async (id) => {
  const [rows] = await pool.execute(sql("preview"), [id]);
  if (!rows[0]) throw createError("Planilla no encontrada", 404);
  const row = rows[0];
  const [jubilados] = await pool.execute(sql("previewJubilados"));
  const lista = jubilados.map(mapJubiladoPreview);
  const aptos = lista.filter((j) => j.apto);
  const excluidosLista = lista.filter((j) => !j.apto);
  return {
    totalActivos: lista.length,
    conDatosPlanilla: aptos.length,
    conSalario: lista.filter((j) => j.tieneSalario).length,
    excluidos: excluidosLista.length,
    porcentajePago: toNum(row.porcentaje_pago),
    estadoProceso: row.estado_proceso,
    jubiladosAptos: aptos,
    jubiladosExcluidos: excluidosLista
  };
};

// Usamos query() (protocolo de texto) en vez de execute() porque CALL a
// procedimientos con variables de sesión no es totalmente compatible con el
// protocolo de prepared statements en MariaDB. Las variables @out viven en la
// misma conexión, por eso se toma una sola conexion del pool.
const callSp = async (spCall, inParams, outNames) => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CALL ${spCall}`, inParams);
    if (!outNames || outNames.length === 0) return {};
    const outSelect = outNames.map((n) => `@${n} AS ${n}`).join(", ");
    const [[outRow]] = await conn.query(`SELECT ${outSelect}`);
    return outRow;
  } finally {
    conn.release();
  }
};

const generar = async (id, tipoIngreso, currentUser) => {
  const planilla = await getById(id);
  // CAMBIO X: se permite generar desde ABIERTA o REVERSADA (volver a generar).
  assertCan("generar", planilla.estadoProceso);
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Generando nomina pensionados", { idPlanilla: id, usuario });

  const out = await callSp(
    `sp_generar_nomina_pensionados(?, ?, ?, @p_proc, @p_excl, @p_pag, @p_desc)`,
    [id, tipoIngreso || 0, usuario],
    ["p_proc", "p_excl", "p_pag", "p_desc"]
  );

  logger.info("Nomina pensionados generada", { idPlanilla: id, ...out });
  return {
    procesados: toNum(out.p_proc),
    excluidos: toNum(out.p_excl),
    totalPagado: toNum(out.p_pag),
    totalDescuentos: toNum(out.p_desc),
    estadoNuevo: "GENERADA"
  };
};

const getDetalle = async (id) => {
  const [rows] = await pool.execute(sql("obtenerDetalle"), [id]);
  return rows.map(mapDetalle);
};

const cerrar = async (id, currentUser) => {
  const planilla = await getById(id);
  assertCan("cerrar", planilla.estadoProceso);
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Cerrando planilla pensionados", { idPlanilla: id, usuario });
  await callSp(`sp_cerrar_planilla(?, ?)`, [id, usuario], []);
  return getById(id);
};

const reversar = async (id, motivo, currentUser) => {
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo de reverso es obligatorio");
  const planilla = await getById(id);
  assertCan("reversar", planilla.estadoProceso);
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Reversando planilla pensionados", { idPlanilla: id, usuario });
  await callSp(`sp_reversar_planilla_pensionados(?, ?, ?)`, [id, usuario, motivo], []);
  return getById(id);
};

const reversarJubilado = async (id, idJubilado, motivo, currentUser) => {
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo de reverso es obligatorio");
  const planilla = await getById(id);
  assertCan("reversar", planilla.estadoProceso);
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Reversando pago de jubilado", { idPlanilla: id, idJubilado, usuario });
  await callSp(`sp_reversar_pago_pensionado(?, ?, ?, ?)`, [id, idJubilado, usuario, motivo], []);
  return getDetalle(id);
};

// CAMBIO X: renglones de ingreso/descuento de un jubilado para edición de montos.
const getMontos = async (id, idJubilado) => {
  const [rows] = await pool.execute(sql("montosJubilado"), [id, idJubilado, id, idJubilado]);
  return rows.map((r) => ({
    clase: r.clase,
    id: r.id,
    concepto: r.concepto,
    valor: toNum(r.valor)
  }));
};

// CAMBIO X: edición de montos. Sólo permitida si la planilla está GENERADA.
const editarMontos = async (id, idJubilado, payload, currentUser) => {
  const planilla = await getById(id);
  assertCan("editarMontos", planilla.estadoProceso);

  const ingresos = Array.isArray(payload?.ingresos) ? payload.ingresos : [];
  const descuentos = Array.isArray(payload?.descuentos) ? payload.descuentos : [];
  if (!ingresos.length && !descuentos.length) throw createError("No se recibieron montos para actualizar");

  const valido = (v) => v !== undefined && v !== null && !Number.isNaN(Number(v)) && Number(v) >= 0;
  for (const ing of ingresos) if (!valido(ing.valor)) throw createError("Los montos de ingreso deben ser números mayores o iguales a 0");
  for (const des of descuentos) if (!valido(des.valor)) throw createError("Los montos de descuento deben ser números mayores o iguales a 0");

  const usuario = currentUser?.usuario || "sistema";
  logger.info("Editando montos jubilado", { idPlanilla: id, idJubilado, usuario });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const ing of ingresos) {
      const valor = toNum(ing.valor);
      await conn.execute(sql("actualizarMontoIngreso"), [valor, valor, ing.id, id, idJubilado]);
    }
    for (const des of descuentos) {
      await conn.execute(sql("actualizarMontoDescuento"), [toNum(des.valor), des.id, id, idJubilado]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return getDetalle(id);
};

const estadoCuenta = async (idJubilado) => {
  const [rows] = await pool.execute(sql("estadoCuenta"), [idJubilado]);
  if (!rows[0]) throw createError("Jubilado no encontrado", 404);
  const r = rows[0];
  const [deudas] = await pool.execute(sql("detalleDeudas"), [idJubilado]);
  return {
    idJubilado: r.id_jubilado,
    nombreCompleto: r.nombre_completo,
    dpi: r.dpi,
    mesesTotales: toNum(r.meses_totales),
    mesesPagados: toNum(r.meses_pagados),
    mesesPendientes: toNum(r.meses_pendientes),
    montoOriginalTotal: toNum(r.monto_original_total),
    montoPagadoTotal: toNum(r.monto_pagado_total),
    deudaPendienteTotal: toNum(r.deuda_pendiente_total),
    periodoMasAntiguoPendiente: r.periodo_mas_antiguo_pendiente,
    deudas: deudas.map((d) => ({
      id: d.id,
      periodo: d.periodo,
      montoOriginal: toNum(d.montoOriginal),
      montoPagado: toNum(d.montoPagado),
      montoPendiente: toNum(d.montoPendiente),
      estado: d.estado,
      fechaGeneracion: d.fechaGeneracion,
      fechaSaldada: d.fechaSaldada
    }))
  };
};

const generarDeudaHistoricaMasivo = async (periodoFinal, porcentaje, currentUser) => {
  if (!periodoFinal || String(periodoFinal).length !== 6) throw createError("El periodo final debe tener formato YYYYMM");
  const pct = toNum(porcentaje);
  if (pct <= 0 || pct > 100) throw createError("El porcentaje debe estar entre 1 y 100");
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Generando deuda historica masivo", { periodoFinal, porcentaje: pct, usuario });

  const out = await callSp(
    `sp_generar_deuda_historica_masivo(?, ?, ?, @p_jub, @p_deu)`,
    [Number(periodoFinal), pct, usuario],
    ["p_jub", "p_deu"]
  );

  return {
    jubiladosProcesados: toNum(out.p_jub),
    totalDeudas: toNum(out.p_deu)
  };
};

const exportExcel = async (id) => {
  const [planilla, detalle] = await Promise.all([getById(id), getDetalle(id)]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Nomina Pensionados");

  ws.columns = [
    { header: "DPI",               key: "dpi",               width: 16 },
    { header: "Nombre Completo",   key: "nombreCompleto",     width: 30 },
    { header: "Fecha Jubilación",  key: "fechaJubilacion",    width: 16 },
    { header: "Pensión Teórica",   key: "pensionTeorica",     width: 16 },
    { header: "% Aplicado",        key: "porcentajeAplicado", width: 12 },
    { header: "Pago Corriente",    key: "pagoCorriente",      width: 16 },
    { header: "Abono Histórico",   key: "abonoHistorico",     width: 16 },
    { header: "Período Aplicado",  key: "periodoAplicado",    width: 16 },
    { header: "Total Ingreso",     key: "totalIngreso",       width: 16 },
    { header: "Descuentos",        key: "totalDescuentos",    width: 16 },
    { header: "Neto a Pagar",      key: "netoPagar",          width: 16 }
  ];

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  detalle.forEach((r) => ws.addRow(r));

  // Totals row
  const tot = ws.addRow({
    nombreCompleto: "TOTAL",
    totalIngreso: detalle.reduce((s, r) => s + r.totalIngreso, 0),
    totalDescuentos: detalle.reduce((s, r) => s + r.totalDescuentos, 0),
    netoPagar: detalle.reduce((s, r) => s + r.netoPagar, 0)
  });
  tot.font = { bold: true };

  ws.properties.defaultRowHeight = 18;
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: buf, filename: `nomina_pensionados_${planilla.numero}.xlsx` };
};

const exportBanco = async (id) => {
  const detalle = await getDetalle(id);
  const planilla = await getById(id);
  const lines = detalle.map((r) => {
    const cuenta = (r.cuentaBanco || "").replace(/\s/g, "");
    const monto = r.netoPagar.toFixed(2);
    const nombre = r.nombreCompleto.substring(0, 40).padEnd(40);
    return `${cuenta}|${nombre}|${monto}`;
  });
  return {
    content: lines.join("\n"),
    filename: `banco_pensionados_${planilla.numero}.txt`
  };
};

module.exports = {
  list, getById, create, update, preview,
  generar, getDetalle, cerrar, reversar, reversarJubilado,
  getMontos, editarMontos,
  estadoCuenta, generarDeudaHistoricaMasivo, exportExcel, exportBanco
};
