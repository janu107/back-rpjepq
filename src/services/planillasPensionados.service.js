const logger = require("../config/logger");
const { pool } = require("../config/db");
const tiposMonto = require("./tiposMonto.service");
const getSql = require("../utils/sqlLoader");
const ExcelJS = require("exceljs");
const { assertCan, createError } = require("../utils/planillaEstado");

// Tipos que administra esta pantalla: 2 = nómina de jubilados (pensionados),
// 4 = nómina de amparistas. Antes el tipo era fijo en 2 y los amparistas se
// generaban desde otra pantalla; ahora ambos viven en el módulo de Nóminas.
const TIPO_PENSIONADOS = 2;
const TIPO_AMPARISTAS = 4;
const TIPOS_VALIDOS = [TIPO_PENSIONADOS, TIPO_AMPARISTAS];

const sql = (file) => getSql(`planillas-pensionados/${file}.sql`);

const toNum = (v) => Number(v || 0);

// Nombre legible a partir del id numérico del tipo de planilla.
//
// No se usa RPJ_CAT_TIPO_PLANILLA.tpl_tipo_planilla: en producción esa columna
// guarda una bandera ("1") para todas las filas, no el nombre, así que la
// pantalla mostraba "1" como tipo. El nombre real está en tpl_descripcion, pero
// su formato cambia entre ambientes; el id numérico es nuestro y es estable.
const NOMBRE_POR_TIPO = { 2: "NÓMINA JUBILADOS", 4: "NÓMINA AMPARISTAS" };

const mapPlanilla = (row) => ({
  id: row.id,
  tipoPlanilla: row.tipo_planilla,
  tipoPlanillaNombre: NOMBRE_POR_TIPO[Number(row.tipo_planilla)]
    || row.tipo_planilla_descripcion
    || row.tipo_planilla_nombre,
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
  codigo: row.codigo,
  dpi: row.dpi,
  nombreCompleto: row.nombre_completo,
  idBeneficiario: row.id_beneficiario || null,
  conceptoBeneficiario: row.concepto_beneficiario || null,
  fallecido: row.fallecido || null,
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


// Solo se crea una planilla nueva cuando todas las anteriores del mismo tipo están
// CERRADAS: una ABIERTA, GENERADA o REVERSADA hay que terminarla primero.
const MESES_TXT = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
const assertTodasCerradas = async (tipoPlanilla, nombre) => {
  const [[pend]] = await pool.execute(
    `SELECT ppl_numero AS numero, ppl_estado_proceso AS estado FROM RPJ_CAT_PARAMETRO_PLANILLA
      WHERE ppl_tipo_planilla = ? AND ppl_estado_proceso <> 'CERRADA'
      ORDER BY ppl_numero LIMIT 1`, [tipoPlanilla]);
  if (pend) {
    const n = String(pend.numero);
    const periodo = n.length === 6 ? `${MESES_TXT[Number(n.slice(4)) - 1]} ${n.slice(0, 4)}` : n;
    throw createError(`NO SE PUEDE CREAR OTRA PLANILLA DE ${nombre}: LA DE ${periodo} ESTÁ ${pend.estado}. CIÉRRELA PRIMERO.`, 409);
  }
};

const create = async (payload, currentUser) => {
  validate(payload);
  const tipoPlanilla = TIPOS_VALIDOS.includes(Number(payload.tipoPlanilla))
    ? Number(payload.tipoPlanilla)
    : TIPO_PENSIONADOS;
  // Evitar planillas duplicadas por tipo + numero (Version VII)
  const [dup] = await pool.execute(
    "SELECT ppl_correlativo FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = ? AND ppl_numero = ?",
    [tipoPlanilla, payload.numero]
  );
  if (dup.length) {
    throw createError(
      `YA EXISTE UNA PLANILLA DE ${tipoPlanilla === TIPO_AMPARISTAS ? "AMPARISTAS" : "PENSIONADOS"} CON ESE NUMERO`,
      409
    );
  }
  await assertTodasCerradas(tipoPlanilla, tipoPlanilla === TIPO_AMPARISTAS ? "AMPARISTAS" : "JUBILADOS");
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

// Genera la nómina con el SP que corresponda al tipo de la planilla:
//   tipo 2 -> sp_generar_nomina_pensionados (jubilados normales + beneficiarios)
//   tipo 4 -> sp_generar_nomina_amparistas  (amparistas, siempre al 100%)
// Así una sola pantalla cubre ambos casos y no hay que recordar cuál botón va
// con cuál planilla.
const generar = async (id, tipoIngreso, currentUser) => {
  const planilla = await getById(id);
  // CAMBIO X: se permite generar desde ABIERTA o REVERSADA (volver a generar).
  assertCan("generar", planilla.estadoProceso);
  const usuario = currentUser?.usuario || "sistema";
  const esAmparistas = Number(planilla.tipoPlanilla) === TIPO_AMPARISTAS;
  logger.info("Generando nomina", { idPlanilla: id, tipoPlanilla: planilla.tipoPlanilla, usuario });

  if (esAmparistas) {
    const out = await callSp(
      "sp_generar_nomina_amparistas(?, ?, @p_proc, @p_total, @p_res)",
      [id, usuario],
      ["p_proc", "p_total", "p_res"]
    );
    logger.info("Nomina amparistas generada", { idPlanilla: id, ...out });
    return {
      procesados: toNum(out.p_proc),
      excluidos: 0,
      totalPagado: toNum(out.p_total),
      totalDescuentos: 0,
      mensaje: out.p_res,
      estadoNuevo: "GENERADA"
    };
  }

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
  // Jubilados: al cerrar, el mes entra a la deuda y lo pagado se abona a los
  // meses pendientes más antiguos (con los montos ya editados). Amparistas no
  // manejan deuda.
  if (Number(planilla.tipoPlanilla) !== TIPO_AMPARISTAS) {
    const out = await callSp(`sp_cuadrar_planilla_pensionados(?, ?, @p_aju)`, [id, usuario], ["p_aju"]);
    if (toNum(out.p_aju) > 0) logger.info("Pago aplicado a la deuda al cerrar", { idPlanilla: id, jubilados: toNum(out.p_aju) });
  }
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
const getTiposMonto = () => tiposMonto.listarTiposMonto();

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
  // Renglones agregados a mano (tipo de ingreso o descuento que no generó el proceso).
  const nuevos = tiposMonto.validarNuevos(payload?.nuevos, createError);
  // Renglones a borrar: [{ clase: "INGRESO" | "DESCUENTO", id }]
  const eliminar = (Array.isArray(payload?.eliminar) ? payload.eliminar : [])
    .map((e) => ({ clase: String(e?.clase || "").toUpperCase(), id: Number(e?.id) }))
    .filter((e) => ["INGRESO", "DESCUENTO"].includes(e.clase) && Number.isInteger(e.id) && e.id > 0);
  if (!ingresos.length && !descuentos.length && !nuevos.length && !eliminar.length) throw createError("No se recibieron montos para actualizar");

  const valido = (v) => v !== undefined && v !== null && !Number.isNaN(Number(v)) && Number(v) >= 0;
  for (const ing of ingresos) if (!valido(ing.valor)) throw createError("Los montos de ingreso deben ser números mayores o iguales a 0");
  for (const des of descuentos) if (!valido(des.valor)) throw createError("Los montos de descuento deben ser números mayores o iguales a 0");

  const usuario = currentUser?.usuario || "sistema";
  logger.info("Editando montos jubilado", { idPlanilla: id, idJubilado, usuario });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Borrar renglones. Un descuento de préstamo o judicial devuelve su cuota al
    // saldo (la generación ya la había rebajado). No se permite dejar a la persona
    // sin ingresos: para sacarla de la planilla está "Reversar pago".
    const borrarIngresos = eliminar.filter((e) => e.clase === "INGRESO").map((e) => e.id);
    if (borrarIngresos.length) {
      const [[cuenta]] = await conn.query(
        "SELECT COUNT(*) AS total, SUM(nin_correlativo IN (?)) AS borrar FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = ? AND nin_id_jubilado = ? AND nin_tipo_manejo = 2",
        [borrarIngresos, id, idJubilado]);
      if (toNum(cuenta.borrar) >= toNum(cuenta.total)) {
        throw createError("No se puede borrar el único ingreso. Para quitar a la persona de la planilla use \"Reversar pago\".");
      }
      await conn.query(
        "DELETE FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_correlativo IN (?) AND nin_id_planilla = ? AND nin_id_jubilado = ? AND nin_tipo_manejo = 2",
        [borrarIngresos, id, idJubilado]);
    }
    for (const e of eliminar.filter((x) => x.clase === "DESCUENTO")) {
      const [[d]] = await conn.query(
        "SELECT nde_tipo_descuento AS tipo, nde_valor AS valor, nde_id_prestamo AS prestamo FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_correlativo = ? AND nde_id_planilla = ? AND nde_id_jubilado = ? AND nde_tipo_manejo = 2",
        [e.id, id, idJubilado]);
      if (!d) continue;
      if (d.prestamo) {
        await conn.query("UPDATE RPJ_MNT_PRESTAMOS_REGIMEN SET prr_saldo = prr_saldo + ?, prr_estado = 'ACTIVO' WHERE prr_correlativo = ?", [d.valor, d.prestamo]);
      } else if (Number(d.tipo) === 4) {
        await conn.query(
          "UPDATE RPJ_MNT_DESC_JUDICIALES SET dju_saldo = dju_saldo + ?, dju_estado = 'ACTIVO' WHERE dju_id_jubilado = ? AND dju_tipo_manejo = 2 ORDER BY dju_correlativo LIMIT 1",
          [d.valor, idJubilado]);
      }
      await conn.query("DELETE FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_correlativo = ?", [e.id]);
    }
    const borrados = new Set(eliminar.map((e) => `${e.clase}-${e.id}`));

    for (const ing of ingresos) {
      if (borrados.has(`INGRESO-${ing.id}`)) continue;
      const valor = toNum(ing.valor);
      await conn.execute(sql("actualizarMontoIngreso"), [valor, valor, ing.id, id, idJubilado]);
    }
    for (const des of descuentos) {
      if (borrados.has(`DESCUENTO-${des.id}`)) continue;
      await conn.execute(sql("actualizarMontoDescuento"), [toNum(des.valor), des.id, id, idJubilado]);
    }
    for (const n of nuevos) {
      const [res] = n.clase === "INGRESO"
        ? await conn.execute(sql("agregarIngreso"), [n.tipo, n.valor, n.valor, n.valor, usuario, id, idJubilado])
        : await conn.execute(sql("agregarDescuento"), [n.tipo, n.valor, usuario, id, idJubilado]);
      if (!res.affectedRows) throw createError("No se pudo agregar el renglón: la persona no tiene pagos en esta planilla");
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

// Antes de la carga histórica se revisa que la base tenga lo que el procedimiento
// necesita. Sin esto, en producción cualquier faltante (migración sin correr,
// columna que no existe) llegaba a la pantalla como "Error interno del servidor".
const REQUISITOS_CARGA = {
  RPJ_MNT_JUBILADO: ["jub_correlativo", "jub_tipo_manejo", "jub_estado", "jub_tipo_pago", "jub_estado_pago", "jub_fecha_jubilacion"],
  RPJ_MNT_SALARIO: ["sal_id_jubilado", "sal_tipo_manejo", "sal_tipo_ingreso", "sal_salario", "sal_correlativo"],
  RPJ_CAT_PARAMETRO_PLANILLA: ["ppl_tipo_planilla", "ppl_numero", "ppl_estado", "ppl_aplica_porcentaje", "ppl_porcentaje_pago",
    "ppl_estado_proceso", "ppl_fecha_generacion", "ppl_fecha_cierre", "ppl_usuario_genera", "ppl_usuario_cierra"],
  RPJ_PRC_NOMINA_INGRESO: ["nin_valor_teorico", "nin_porcentaje_aplicado", "nin_pago_corriente", "nin_abono_historico", "nin_id_deuda_aplicada"],
  RPJ_PRC_DEUDA_JUBILADO: ["deu_id_jubilado", "deu_periodo", "deu_monto_original", "deu_monto_pagado", "deu_monto_pendiente",
    "deu_estado", "deu_tipo_pago", "deu_fecha_generacion", "deu_observaciones", "deu_usuario_creacion"],
  RPJ_PRC_APLICACION_PAGO: ["apa_id_deuda"]
};

const verificarRequisitosCarga = async () => {
  const [rutinas] = await pool.query(
    `SELECT ROUTINE_NAME FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = DATABASE() AND LOWER(ROUTINE_NAME) = 'sp_carga_historica_jubilados'`
  );
  if (!rutinas.length) {
    throw createError("Falta instalar el procedimiento de carga histórica en la base de datos. En el servidor ejecute: node scripts/runSqlFile.js sql/migraciones/migration_carga_historica_jubilados.sql", 409);
  }

  const [cols] = await pool.query(
    `SELECT UPPER(TABLE_NAME) AS tabla, LOWER(COLUMN_NAME) AS columna FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND UPPER(TABLE_NAME) IN (${Object.keys(REQUISITOS_CARGA).map(() => "?").join(", ")})`,
    Object.keys(REQUISITOS_CARGA)
  );
  const existentes = new Set(cols.map((c) => `${c.tabla}.${c.columna}`));
  const faltantes = [];
  Object.entries(REQUISITOS_CARGA).forEach(([tabla, columnas]) => {
    if (!cols.some((c) => c.tabla === tabla)) { faltantes.push(`tabla ${tabla}`); return; }
    columnas.forEach((c) => { if (!existentes.has(`${tabla}.${c}`)) faltantes.push(`${tabla}.${c}`); });
  });
  if (faltantes.length) {
    throw createError(`La base de datos no tiene lo necesario para la carga histórica. Falta: ${faltantes.join(", ")}`, 409);
  }
};

// Carga histórica (documento "DEUDA HISTORIAL"): crea las planillas de jubilados
// mes a mes desde la jubilación más antigua hasta el mes anterior al actual, y la
// deuda desde el período indicado. Ver sp_carga_historica_jubilados.
//   periodoDeuda: YYYYMM desde el que se paga el porcentaje (antes, pago completo).
const generarDeudaHistoricaMasivo = async (periodoDeuda, porcentaje, currentUser) => {
  const periodo = Number(periodoDeuda);
  if (!/^\d{6}$/.test(String(periodoDeuda || "")) || periodo % 100 < 1 || periodo % 100 > 12) {
    throw createError("El período debe tener formato YYYYMM (ej. 202303)");
  }
  const pct = toNum(porcentaje);
  if (pct <= 0 || pct > 100) throw createError("El porcentaje debe estar entre 1 y 100");
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Carga histórica de jubilados", { periodoDeuda: periodo, porcentaje: pct, usuario });

  await verificarRequisitosCarga();

  let out;
  try {
    out = await callSp(
    `sp_carga_historica_jubilados(?, ?, ?, @p_jub, @p_pla, @p_ren, @p_deu, @p_eli, @p_aju, @p_ini, @p_fin)`,
    [periodo, pct, usuario],
    ["p_jub", "p_pla", "p_ren", "p_deu", "p_eli", "p_aju", "p_ini", "p_fin"]
  );
  } catch (error) {
    // Operación de administrador: se muestra el motivo real de la base en vez del
    // genérico "Error interno del servidor", para poder corregirlo.
    logger.error("Falló la carga histórica de jubilados", { code: error.code, sqlMessage: error.sqlMessage, message: error.message });
    if (error.status) throw error;
    throw createError(`No se pudo completar la carga histórica: ${error.sqlMessage || error.message}`, 409);
  }

  // Jubilados activos sin pensión configurada: se omiten hasta que tengan valor.
  const [[sinPension]] = await pool.query(
    `SELECT COUNT(*) AS total FROM RPJ_MNT_JUBILADO j
      WHERE j.jub_tipo_manejo = 2 AND UPPER(COALESCE(j.jub_estado,'')) = 'ACTIVO'
        AND NOT EXISTS (SELECT 1 FROM RPJ_MNT_SALARIO s
                         WHERE s.sal_id_jubilado = j.jub_correlativo AND s.sal_tipo_manejo = 2
                           AND s.sal_tipo_ingreso = 1 AND s.sal_salario > 0)`
  );

  // Préstamos del mismo jubilado cuyas vigencias se cruzan (p. ej. una renovación
  // registrada sin terminar el anterior): esos meses restan las dos cuotas. No se
  // bloquea (puede ser real tener dos préstamos), solo se avisa para revisar.
  const [traslapes] = await pool.query(
    `SELECT DISTINCT j.jub_id AS codigo, CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS nombre,
            a.prr_no_referencia AS refA, b.prr_no_referencia AS refB,
            GREATEST(a.prr_fecha_inicio, b.prr_fecha_inicio) AS desde, LEAST(a.prr_fecha_fin, b.prr_fecha_fin) AS hasta
       FROM RPJ_MNT_PRESTAMOS_REGIMEN a
       JOIN RPJ_MNT_PRESTAMOS_REGIMEN b ON b.prr_id_jubilado = a.prr_id_jubilado AND b.prr_correlativo > a.prr_correlativo
       JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = a.prr_id_jubilado
      WHERE a.prr_tipo_manejo = 2 AND b.prr_tipo_manejo = 2
        AND a.prr_estado <> 'ANULADO' AND b.prr_estado <> 'ANULADO'
        AND a.prr_fecha_inicio <= b.prr_fecha_fin AND b.prr_fecha_inicio <= a.prr_fecha_fin
      ORDER BY nombre LIMIT 50`
  );

  return {
    prestamosTraslapados: traslapes.map((t) => ({ ...t, desde: t.desde, hasta: t.hasta })),
    jubiladosProcesados: toNum(out.p_jub),
    planillasCreadas: toNum(out.p_pla),
    renglones: toNum(out.p_ren),
    totalDeudas: toNum(out.p_deu),
    deudasEliminadas: toNum(out.p_eli),
    deudasAjustadas: toNum(out.p_aju),
    periodoInicio: out.p_ini ? Number(out.p_ini) : null,
    periodoFin: out.p_fin ? Number(out.p_fin) : null,
    sinPension: toNum(sinPension.total)
  };
};

const exportExcel = async (id) => {
  const planillaBase = await getById(id);
  // Nómina de jubilados: mismo formato que el PDF de la nómina.
  if (Number(planillaBase.tipoPlanilla) !== TIPO_AMPARISTAS) {
    return require("./impresiones.service").excelNominaJubilados(id);
  }
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
  getTiposMonto,
  list, getById, create, update, preview,
  generar, getDetalle, cerrar, reversar, reversarJubilado,
  getMontos, editarMontos,
  estadoCuenta, generarDeudaHistoricaMasivo, exportExcel, exportBanco
};
