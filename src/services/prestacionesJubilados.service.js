const ExcelJS = require("exceljs");
const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

// Prestaciones para Jubilados: Bono 14 (planilla tipo 6) y Aguinaldo (tipo 8).
// A diferencia del módulo de prestaciones de régimen, cada prestación se genera
// con 3 SP independientes contra la MISMA planilla (activos NORMALES,
// beneficiarios de fallecidos, amparistas). Este servicio orquesta las 3
// llamadas y, si alguna falla a la mitad, revierte lo ya insertado para que
// nunca quede una planilla "a medias" desde el punto de vista del usuario.
//
// Sin deuda histórica ni descuentos (IGSS/ISR): estos SP no tocan
// RPJ_PRC_DEUDA_JUBILADO ni RPJ_PRC_NOMINA_DESCUENTO.

const sql = (file) => getSql(`prestaciones-jubilados/${file}.sql`);
const num = (v) => Number(v || 0);

const PRESTACIONES = {
  bono14: {
    key: "bono14",
    tipoPlanilla: 6,
    nombre: "BONO 14 JUBILADOS",
    spActivos: "sp_generar_bono14_jub_activos",
    spBeneficiarios: "sp_generar_bono14_beneficiarios",
    spAmparistas: "sp_generar_bono14_amparistas"
  },
  aguinaldo: {
    key: "aguinaldo",
    tipoPlanilla: 8,
    nombre: "AGUINALDO JUBILADOS",
    spActivos: "sp_generar_aguinaldo_jub_activos",
    spBeneficiarios: "sp_generar_aguinaldo_beneficiarios",
    spAmparistas: "sp_generar_aguinaldo_amparistas"
  }
};

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const getTipo = (tipo) => {
  const config = PRESTACIONES[String(tipo || "").toLowerCase()];
  if (!config) throw createError("Tipo de prestación inválido. Use bono14 o aguinaldo.", 404);
  return config;
};

const periodoDe = (tipo, anio) => {
  const y = Number(anio);
  if (tipo === "bono14") return { inicio: `${y - 1}-07-01`, fin: `${y}-06-30` };
  return { inicio: `${y - 1}-12-01`, fin: `${y}-11-30` };
};

const mapPlanilla = (r) => ({
  id: r.id,
  tipoPlanilla: r.tipo_planilla,
  tipoPlanillaNombre: r.tipo_planilla === 6 ? "BONO 14 JUBILADOS" : r.tipo_planilla === 8 ? "AGUINALDO JUBILADOS" : null,
  numero: r.numero,
  fechaInicio: r.fecha_inicio,
  fechaFinal: r.fecha_final,
  fechaPago: r.fecha_pago,
  estadoProceso: r.estado_proceso || "ABIERTA",
  fechaGeneracion: r.fecha_generacion,
  usuarioGenera: r.usuario_genera,
  totalRegistros: num(r.total_registros),
  totalPagado: num(r.total_pagado)
});

const mapDetalle = (r) => ({
  idLinea: r.id_linea,
  idJubilado: r.id_jubilado,
  idBeneficiario: r.id_beneficiario,
  nombreCompleto: r.nombre_completo,
  dpi: r.dpi,
  categoria: r.categoria,
  jubiladoTitular: r.jubilado_titular,
  tipoJubilacion: r.tipo_jubilacion,
  dias: num(r.dias),
  pensionBase: num(r.pension_base),
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

const getByIdDelTipo = async (tipo, id) => {
  const { tipoPlanilla, nombre } = getTipo(tipo);
  const planilla = await getById(id);
  if (planilla.tipoPlanilla !== tipoPlanilla) throw createError(`La planilla ${id} no es de ${nombre}.`, 409);
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

const esError = (resultado) => String(resultado || "").toUpperCase().includes("ERROR");

// Firma compartida por los SP de activos y beneficiarios: (id, anio, porcentaje, usuario, OUT...).
const generarConPorcentaje = (spName, idPlanilla, anio, porcentaje, usuario) =>
  callSp(`${spName}(?, ?, ?, ?, @p_procesados, @p_total, @p_resultado)`,
    [idPlanilla, anio, porcentaje, usuario], ["p_procesados", "p_total", "p_resultado"]);

const generarAmparistas = (spName, idPlanilla, anio, usuario) =>
  callSp(`${spName}(?, ?, ?, @p_procesados, @p_total, @p_resultado)`,
    [idPlanilla, anio, usuario], ["p_procesados", "p_total", "p_resultado"]);

const revertirInterno = async (idPlanilla, usuario, motivo) =>
  callSp("sp_revertir_prestacion_jubilados(?, ?, ?, @p_eliminados, @p_resultado)",
    [idPlanilla, usuario, motivo], ["p_eliminados", "p_resultado"]);

// Genera los 3 grupos en secuencia (activos, beneficiarios, amparistas) contra
// la misma planilla. Si alguno falla, revierte lo que ya se hubiera generado
// en esta MISMA corrida antes de avisar al usuario — así "Procesar los 3
// grupos" es, desde afuera, una operación todo-o-nada.
const generar = async (tipo, payload, currentUser) => {
  const config = getTipo(tipo);
  const idPlanilla = Number(payload?.idPlanilla);
  const anio = Number(payload?.anio);
  const porcentaje = Number(payload?.porcentaje);
  if (!idPlanilla) throw createError("Debe indicar la planilla a generar");
  if (!anio || anio < 1900 || anio > 2999) throw createError("El año es obligatorio y debe ser válido");
  if (!porcentaje || porcentaje < 0.01 || porcentaje > 100) throw createError("El porcentaje debe estar entre 0.01 y 100.00");

  const planillaAntes = await getByIdDelTipo(tipo, idPlanilla);
  const usuario = currentUser?.usuario || "sistema";
  logger.info(`Generando ${config.nombre}`, { idPlanilla, anio, porcentaje, usuario });

  const pasos = [];
  const revertirYThrow = async (mensaje) => {
    // Solo revertimos si esta corrida alcanzó a dejar algo GENERADO; si la
    // planilla seguía ABIERTA (activos fue el primer paso y falló), no hay
    // nada que limpiar.
    const actual = await getById(idPlanilla);
    if (actual.estadoProceso === "GENERADA" && planillaAntes.estadoProceso !== "GENERADA") {
      await revertirInterno(idPlanilla, usuario, `Reverso automático: ${mensaje}`);
    }
    throw createError(mensaje, 409);
  };

  const outActivos = await generarConPorcentaje(config.spActivos, idPlanilla, anio, porcentaje, usuario);
  if (esError(outActivos.p_resultado)) throw createError(outActivos.p_resultado, 409);
  pasos.push({ grupo: "activos", procesados: num(outActivos.p_procesados), total: num(outActivos.p_total), resultado: outActivos.p_resultado });

  const outBeneficiarios = await generarConPorcentaje(config.spBeneficiarios, idPlanilla, anio, porcentaje, usuario);
  if (esError(outBeneficiarios.p_resultado)) await revertirYThrow(`Fallo en beneficiarios: ${outBeneficiarios.p_resultado}`);
  pasos.push({ grupo: "beneficiarios", procesados: num(outBeneficiarios.p_procesados), total: num(outBeneficiarios.p_total), resultado: outBeneficiarios.p_resultado });

  const outAmparistas = await generarAmparistas(config.spAmparistas, idPlanilla, anio, usuario);
  if (esError(outAmparistas.p_resultado)) await revertirYThrow(`Fallo en amparistas: ${outAmparistas.p_resultado}`);
  pasos.push({ grupo: "amparistas", procesados: num(outAmparistas.p_procesados), total: num(outAmparistas.p_total), resultado: outAmparistas.p_resultado });

  const totalProcesados = pasos.reduce((s, p) => s + p.procesados, 0);
  const totalPagado = pasos.reduce((s, p) => s + p.total, 0);
  logger.info(`${config.nombre} generada`, { idPlanilla, totalProcesados, totalPagado });

  return {
    resultado: `PROCESO EXITOSO. Activos: ${pasos[0].procesados}. Beneficiarios: ${pasos[1].procesados}. Amparistas: ${pasos[2].procesados}. Total: Q${totalPagado.toFixed(2)}.`,
    pasos,
    totalProcesados,
    totalPagado,
    planilla: await getById(idPlanilla)
  };
};

const revertir = async (tipo, id, motivo, currentUser) => {
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo de la reversión es obligatorio");
  await getByIdDelTipo(tipo, id);
  const usuario = currentUser?.usuario || "sistema";
  const out = await revertirInterno(id, usuario, motivo);
  if (esError(out.p_resultado)) throw createError(out.p_resultado, 409);
  return { resultado: out.p_resultado, eliminados: num(out.p_eliminados), planilla: await getById(id) };
};

const getDetalle = async (id) => {
  const [rows] = await pool.execute(sql("detalle"), [id]);
  return rows.map(mapDetalle);
};

const editarMonto = async (idLinea, monto, currentUser) => {
  const nuevo = Number(monto);
  if (!nuevo || nuevo <= 0) throw createError("El monto debe ser mayor a cero");
  const usuario = currentUser?.usuario || "sistema";
  const out = await callSp("sp_editar_monto_prestacion(?, ?, ?, @p_resultado)", [idLinea, nuevo, usuario], ["p_resultado"]);
  if (esError(out.p_resultado)) throw createError(out.p_resultado, 409);
  return { resultado: out.p_resultado };
};

const eliminarLinea = async (idLinea, motivo, currentUser) => {
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo es obligatorio");
  const usuario = currentUser?.usuario || "sistema";
  const out = await callSp("sp_eliminar_linea_prestacion(?, ?, ?, @p_resultado)", [idLinea, usuario, motivo], ["p_resultado"]);
  if (esError(out.p_resultado)) throw createError(out.p_resultado, 409);
  return { resultado: out.p_resultado };
};

const agregar = async (idPlanilla, payload, currentUser) => {
  const idJubilado = Number(payload?.idJubilado);
  const idBeneficiario = payload?.idBeneficiario ? Number(payload.idBeneficiario) : null;
  const monto = Number(payload?.monto);
  const dias = Number(payload?.dias || 0);
  if (!idJubilado) throw createError("Debe seleccionar un jubilado");
  if (!monto || monto <= 0) throw createError("El monto debe ser mayor a cero");
  const usuario = currentUser?.usuario || "sistema";
  const out = await callSp(
    "sp_agregar_jubilado_prestacion(?, ?, ?, ?, ?, ?, @p_resultado)",
    [idPlanilla, idJubilado, idBeneficiario, monto, dias, usuario],
    ["p_resultado"]
  );
  if (esError(out.p_resultado)) throw createError(out.p_resultado, 409);
  return { resultado: out.p_resultado };
};

const getCandidatosJubilados = async (idPlanilla) => {
  const [rows] = await pool.execute(sql("candidatosJubilado"), [idPlanilla]);
  return rows.map((r) => ({
    idJubilado: r.id_jubilado,
    dpi: r.dpi,
    nombreCompleto: r.nombre_completo,
    tipoPago: r.tipo_pago,
    fechaJubilacion: r.fecha_jubilacion,
    pension: num(r.pension)
  }));
};

const getCandidatosBeneficiarios = async (idPlanilla) => {
  const [rows] = await pool.execute(sql("candidatosBeneficiario"), [idPlanilla]);
  return rows.map((r) => ({
    idBeneficiario: r.id_beneficiario,
    idJubilado: r.id_jubilado,
    dpi: r.dpi,
    nombreCompleto: r.nombre_completo,
    parentesco: r.parentesco,
    porcentaje: num(r.porcentaje),
    jubiladoTitular: r.jubilado_titular,
    pension: num(r.pension)
  }));
};

const preview = async (tipo, query) => {
  const config = getTipo(tipo);
  const anio = Number(query?.anio) || new Date().getFullYear();
  const porcentaje = Number(query?.porcentaje || 100);
  if (porcentaje < 0.01 || porcentaje > 100) throw createError("El porcentaje debe estar entre 0.01 y 100.00");
  const { inicio, fin } = periodoDe(config.key, anio);

  const [rows] = await pool.execute(sql("previewPeriodo"), [
    porcentaje, fin, inicio, inicio,
    fin, inicio, inicio,
    porcentaje, fin, inicio, inicio
  ]);
  const r = rows[0] || {};
  return {
    tipo: config.key,
    anio,
    periodoInicio: inicio,
    periodoFin: fin,
    porcentaje,
    activos: { total: num(r.total_activos), estimado: num(r.estimado_activos) },
    amparistas: { total: num(r.total_amparistas), estimado: num(r.estimado_amparistas) },
    beneficiarios: { total: num(r.total_beneficiarios), estimado: num(r.estimado_beneficiarios) },
    totalPersonas: num(r.total_activos) + num(r.total_amparistas) + num(r.total_beneficiarios),
    totalEstimado: num(r.estimado_activos) + num(r.estimado_amparistas) + num(r.estimado_beneficiarios)
  };
};

const getResumenPorTipoJubilacion = async (idPlanilla) => {
  const [rows] = await pool.execute(sql("resumenPorTipoJubilacion"), [idPlanilla]);
  return rows.map((r) => ({ tipoJubilacion: r.tipo_jubilacion, totalLineas: num(r.total_lineas), totalPagado: num(r.total_pagado) }));
};

const cerrar = async (id, currentUser) => {
  const planilla = await getById(id);
  if (planilla.estadoProceso !== "GENERADA") throw createError(`No se puede cerrar una planilla en estado ${planilla.estadoProceso}`, 409);
  const usuario = currentUser?.usuario || "sistema";
  const conn = await pool.getConnection();
  try {
    await conn.query("CALL sp_cerrar_planilla(?, ?)", [id, usuario]);
  } finally {
    conn.release();
  }
  return getById(id);
};

const exportExcel = async (id) => {
  const [planilla, detalle] = await Promise.all([getById(id), getDetalle(id)]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(planilla.tipoPlanillaNombre || "Prestacion Jubilados");

  ws.columns = [
    { header: "DPI",             key: "dpi",             width: 16 },
    { header: "Nombre Completo", key: "nombreCompleto",  width: 32 },
    { header: "Categoría",       key: "categoria",       width: 20 },
    { header: "Titular",         key: "jubiladoTitular",  width: 30 },
    { header: "Tipo Jubilación", key: "tipoJubilacion",   width: 20 },
    { header: "Días",            key: "dias",            width: 10 },
    { header: "Pensión Base",    key: "pensionBase",     width: 16 },
    { header: "%",               key: "porcentaje",      width: 8 },
    { header: "Monto",           key: "monto",           width: 16 }
  ];
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E5F" } };

  detalle.forEach((r) => ws.addRow(r));
  const tot = ws.addRow({ nombreCompleto: "TOTAL", monto: detalle.reduce((s, r) => s + num(r.monto), 0) });
  tot.font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const slug = String(planilla.tipoPlanillaNombre || "prestacion_jubilados").toLowerCase().replace(/\s+/g, "_");
  return { buffer: buf, filename: `${slug}_${planilla.numero}.xlsx` };
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
  eliminarLinea,
  agregar,
  getCandidatosJubilados,
  getCandidatosBeneficiarios,
  preview,
  getResumenPorTipoJubilacion,
  cerrar,
  exportExcel
};
