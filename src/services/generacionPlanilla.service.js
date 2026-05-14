const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const GENERAR_PARA = ["EMPLEADOS", "JUBILADOS", "AMBOS"];
const sql = (file) => getSql(`generacion-planilla/${file}.sql`);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toNumber = (value) => Number(value || 0);

const mapPlanilla = (row) => ({
  id: row.ppl_correlativo,
  tipoPlanilla: row.ppl_tipo_planilla,
  numero: row.ppl_numero,
  fechaInicio: row.ppl_fecha_inicio,
  fechaFinal: row.ppl_fecha_final,
  fechaPago: row.ppl_fecha_pago,
  frecuencia: row.ppl_frecuencia,
  estado: row.ppl_estado,
  tipoPlanillaNombre: row.tpl_tipo_planilla,
  tipoPlanillaDescripcion: row.tipo_planilla_descripcion
});

const mapResumen = (ingresos, descuentos) => {
  const personas = new Set();
  ingresos.forEach((row) => personas.add(row.idEmpleado ? `E-${row.idEmpleado}` : `J-${row.idJubilado}`));
  descuentos.forEach((row) => personas.add(row.idEmpleado ? `E-${row.idEmpleado}` : `J-${row.idJubilado}`));
  const totalIngresos = ingresos.reduce((total, row) => total + toNumber(row.valor), 0);
  const totalDescuentos = descuentos.reduce((total, row) => total + toNumber(row.valor), 0);

  return {
    totalIngresos: Number(totalIngresos.toFixed(2)),
    totalDescuentos: Number(totalDescuentos.toFixed(2)),
    liquido: Number((totalIngresos - totalDescuentos).toFixed(2)),
    cantidadPersonas: personas.size,
    cantidadIngresos: ingresos.length,
    cantidadDescuentos: descuentos.length
  };
};

const validatePayload = (payload) => {
  ["idPlanilla", "idTipoPlanilla", "tipoManejo", "generarPara"].forEach((field) => {
    if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === "") {
      throw createError(`El campo ${field} es obligatorio`);
    }
  });

  if (!GENERAR_PARA.includes(String(payload.generarPara).toUpperCase())) {
    throw createError("generarPara solo puede ser EMPLEADOS, JUBILADOS o AMBOS");
  }
};

const getPlanilla = async (idPlanilla) => {
  const [rows] = await pool.execute(sql("obtenerPlanilla"), [idPlanilla]);
  if (!rows[0]) throw createError("La planilla no existe", 404);

  const estado = String(rows[0].ppl_estado || "").toUpperCase();
  if (estado && !["ACTIVO", "ABIERTA"].includes(estado)) {
    throw createError("La planilla no esta activa o abierta");
  }

  return mapPlanilla(rows[0]);
};

const getTipoDescuentoPrestamo = async () => {
  const [rows] = await pool.execute(sql("obtenerTipoDescuentoPrestamo"));
  if (!rows[0]) throw createError("No existe tipo de descuento configurado para prestamos");
  return rows[0].tde_id;
};

const getExisting = async (idPlanilla) => {
  const [rows] = await pool.execute(sql("validarRegistrosExistentes"), [idPlanilla, idPlanilla]);
  const row = rows[0] || {};
  return {
    tieneRegistros: toNumber(row.cantidad_ingresos) > 0 || toNumber(row.cantidad_descuentos) > 0,
    cantidadIngresos: toNumber(row.cantidad_ingresos),
    cantidadDescuentos: toNumber(row.cantidad_descuentos)
  };
};

const first = (rows) => rows[0] || null;

const buildIngreso = ({ payload, persona, salario, valor, tipoIngreso, concepto, idEmpleado = null, idJubilado = null }) => ({
  tipoManejo: Number(payload.tipoManejo),
  idTipoPlanilla: Number(payload.idTipoPlanilla),
  idPlanilla: Number(payload.idPlanilla),
  idEmpleado,
  idJubilado,
  tipoIngreso: Number(tipoIngreso || salario?.sal_tipo_ingreso),
  valor: Number(toNumber(valor).toFixed(2)),
  diasTrabajados: 30,
  puesto: persona.puesto || "N/A",
  area: persona.area || "N/A",
  persona: persona.nombre,
  concepto
});

const buildDescuento = ({ payload, persona, tipoDescuento, valor, concepto, idEmpleado = null, idJubilado = null }) => ({
  tipoManejo: Number(payload.tipoManejo),
  idTipoPlanilla: Number(payload.idTipoPlanilla),
  idPlanilla: Number(payload.idPlanilla),
  idEmpleado,
  idJubilado,
  tipoDescuento: Number(tipoDescuento),
  valor: Number(toNumber(valor).toFixed(2)),
  diasTrabajados: 30,
  puesto: persona.puesto || "N/A",
  area: persona.area || "N/A",
  persona: persona.nombre,
  concepto
});

const buildPreview = async (payload) => {
  validatePayload(payload);
  const normalized = { ...payload, generarPara: String(payload.generarPara).toUpperCase() };
  const planilla = await getPlanilla(normalized.idPlanilla);

  const fechaInicio = planilla.fechaInicio;
  const fechaFinal = planilla.fechaFinal;
  if (Number(planilla.tipoPlanilla) !== Number(normalized.idTipoPlanilla)) {
    throw createError("La planilla seleccionada no corresponde al tipo de planilla indicado");
  }

  const [[salarios], [tiempoExtra], [prestamos], [otrosDescuentos], [dietas], tipoDescuentoPrestamo] = await Promise.all([
    pool.execute(sql("obtenerSalarios"), [normalized.tipoManejo]),
    pool.execute(sql("obtenerTiempoExtraPorRango"), [normalized.tipoManejo, fechaInicio, fechaFinal]),
    pool.execute(sql("obtenerPrestamosActivos"), [fechaInicio, fechaFinal]),
    pool.execute(sql("obtenerOtrosDescuentos"), [normalized.tipoManejo, fechaInicio, fechaFinal]),
    pool.execute(sql("obtenerDietasPorRango"), [fechaInicio, fechaFinal]),
    getTipoDescuentoPrestamo()
  ]);

  const salario = first(salarios);
  if (!salario) throw createError("No existe salario configurado para el tipo de manejo seleccionado");

  const ingresos = [];
  const descuentos = [];
  const includeEmpleados = ["EMPLEADOS", "AMBOS"].includes(normalized.generarPara);
  const includeJubilados = ["JUBILADOS", "AMBOS"].includes(normalized.generarPara);

  if (includeEmpleados) {
    const [empleados] = await pool.execute(sql("obtenerEmpleadosActivos"), [normalized.tipoManejo]);
    empleados.forEach((empleado) => {
      const persona = {
        nombre: `${empleado.emp_nombres || ""} ${empleado.emp_apellidos || ""}`.trim(),
        puesto: empleado.puesto_nombre || empleado.emp_tipo_puesto,
        area: empleado.area_descripcion
      };
      ingresos.push(buildIngreso({ payload: normalized, persona, salario, valor: salario.sal_salario, concepto: "Salario base", idEmpleado: empleado.emp_correlativo }));

      tiempoExtra.filter((item) => Number(item.tex_id_empleado) === Number(empleado.emp_correlativo)).forEach((item) => {
        const valorHora = toNumber(salario.sal_salario) / 30 / 8;
        const factor = 1 + (toNumber(item.par_porcentaje_tiempo_extra) / 100);
        ingresos.push(buildIngreso({
          payload: normalized,
          persona,
          salario,
          valor: valorHora * toNumber(item.tex_cantidad_horas) * factor,
          concepto: `Tiempo extra ${item.tex_tipo_hora || ""}`.trim(),
          idEmpleado: empleado.emp_correlativo
        }));
      });

      prestamos.filter((item) => String(item.apo_dpi) === String(empleado.emp_dpi)).forEach((item) => {
        descuentos.push(buildDescuento({
          payload: normalized,
          persona,
          tipoDescuento: tipoDescuentoPrestamo,
          valor: item.dpr_descuento_nomina_aportacion || item.dpr_cuota_nivelada || item.pre_cuota_nivelada,
          concepto: `Prestamo ${item.pre_correlativo}`,
          idEmpleado: empleado.emp_correlativo
        }));
      });
    });
  }

  if (includeJubilados) {
    const [jubilados] = await pool.execute(sql("obtenerJubiladosActivos"), [normalized.tipoManejo]);
    jubilados.forEach((jubilado) => {
      const persona = {
        nombre: `${jubilado.jub_nombres || ""} ${jubilado.jub_apellidos || ""}`.trim(),
        puesto: "Jubilado",
        area: "Jubilados"
      };
      ingresos.push(buildIngreso({ payload: normalized, persona, salario, valor: salario.sal_salario, concepto: "Ingreso jubilado", idJubilado: jubilado.jub_correlativo }));

      prestamos.filter((item) => String(item.apo_dpi) === String(jubilado.jub_dpi)).forEach((item) => {
        descuentos.push(buildDescuento({
          payload: normalized,
          persona,
          tipoDescuento: tipoDescuentoPrestamo,
          valor: item.dpr_descuento_nomina_aportacion || item.dpr_cuota_nivelada || item.pre_cuota_nivelada,
          concepto: `Prestamo ${item.pre_correlativo}`,
          idJubilado: jubilado.jub_correlativo
        }));
      });
    });
  }

  if (otrosDescuentos.length && (includeEmpleados || includeJubilados)) {
    const personas = [
      ...ingresos.filter((item) => item.idEmpleado || item.idJubilado)
    ].filter((item, index, list) => list.findIndex((other) => other.idEmpleado === item.idEmpleado && other.idJubilado === item.idJubilado) === index);

    personas.forEach((personaIngreso) => {
      otrosDescuentos.forEach((descuento) => {
        descuentos.push(buildDescuento({
          payload: normalized,
          persona: personaIngreso,
          tipoDescuento: descuento.ode_tipo_descuento,
          valor: descuento.ode_valor,
          concepto: descuento.ode_motivo || "Otro descuento",
          idEmpleado: personaIngreso.idEmpleado,
          idJubilado: personaIngreso.idJubilado
        }));
      });
    });
  }

  return {
    planilla,
    ingresos,
    descuentos,
    dietasPendientes: dietas.map((item) => ({
      id: item.die_correlativo,
      persona: `${item.jun_nombre || ""} ${item.jun_apellidos || ""}`.trim(),
      puesto: item.jun_puesto,
      valor: toNumber(item.die_total || item.die_liquido || item.die_valor),
      fechaPago: item.die_fecha_pago
    })),
    resumen: mapResumen(ingresos, descuentos)
  };
};

const preview = async (payload) => {
  logger.info("Preview de generacion de planilla solicitado", payload);
  return buildPreview(payload);
};

const insertIngreso = (connection, row, usuario) => connection.execute(sql("insertarIngreso"), [
  row.tipoManejo, row.idTipoPlanilla, row.idPlanilla, row.idEmpleado, row.idJubilado, row.tipoIngreso,
  row.valor, row.diasTrabajados, row.puesto, row.area, usuario
]);

const insertDescuento = (connection, row, usuario) => connection.execute(sql("insertarDescuento"), [
  row.tipoManejo, row.idTipoPlanilla, row.idPlanilla, row.idEmpleado, row.idJubilado, row.tipoDescuento,
  row.valor, row.diasTrabajados, row.puesto, row.area, usuario
]);

const generar = async (payload, user) => {
  validatePayload(payload);
  const regenerar = Boolean(payload.regenerar);
  logger.info(regenerar ? "Regeneracion de planilla iniciada" : "Generacion de planilla iniciada", { ...payload, user: user?.usuario });

  const existing = await getExisting(payload.idPlanilla);
  if (existing.tieneRegistros && !regenerar) {
    throw createError("La planilla ya tiene registros generados. Debe limpiar o regenerar.", 409);
  }

  const previewData = await buildPreview(payload);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (regenerar || existing.tieneRegistros) {
      await connection.execute(sql("eliminarDescuentosPlanilla"), [payload.idPlanilla]);
      await connection.execute(sql("eliminarIngresosPlanilla"), [payload.idPlanilla]);
    }

    const usuario = user?.usuario || "sistema";
    for (const ingreso of previewData.ingresos) await insertIngreso(connection, ingreso, usuario);
    for (const descuento of previewData.descuentos) await insertDescuento(connection, descuento, usuario);

    await connection.commit();
    logger.info("Planilla generada correctamente", { idPlanilla: payload.idPlanilla, ingresos: previewData.ingresos.length, descuentos: previewData.descuentos.length });
    return previewData;
  } catch (error) {
    await connection.rollback();
    logger.error("Error al generar planilla", { message: error.message, code: error.code, idPlanilla: payload.idPlanilla });
    throw error;
  } finally {
    connection.release();
  }
};

const validar = async (idPlanilla) => {
  logger.info("Validacion de registros de planilla", { idPlanilla });
  return getExisting(idPlanilla);
};

const limpiar = async (idPlanilla, user) => {
  logger.info("Limpieza de planilla iniciada", { idPlanilla, user: user?.usuario });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [descuentos] = await connection.execute(sql("eliminarDescuentosPlanilla"), [idPlanilla]);
    const [ingresos] = await connection.execute(sql("eliminarIngresosPlanilla"), [idPlanilla]);
    await connection.commit();
    logger.info("Planilla limpiada correctamente", { idPlanilla, ingresos: ingresos.affectedRows, descuentos: descuentos.affectedRows });
    return { idPlanilla: Number(idPlanilla), ingresosEliminados: ingresos.affectedRows, descuentosEliminados: descuentos.affectedRows };
  } catch (error) {
    await connection.rollback();
    logger.error("Error al limpiar planilla", { message: error.message, code: error.code, idPlanilla });
    throw error;
  } finally {
    connection.release();
  }
};

const resumen = async (idPlanilla) => {
  logger.info("Resumen de generacion solicitado", { idPlanilla });
  const [rows] = await pool.execute(sql("resumenGeneracion"), [idPlanilla, idPlanilla, idPlanilla, idPlanilla, idPlanilla, idPlanilla]);
  const row = rows[0] || {};
  const totalIngresos = toNumber(row.total_ingresos);
  const totalDescuentos = toNumber(row.total_descuentos);
  return {
    totalIngresos,
    totalDescuentos,
    liquido: Number((totalIngresos - totalDescuentos).toFixed(2)),
    cantidadIngresos: toNumber(row.cantidad_ingresos),
    cantidadDescuentos: toNumber(row.cantidad_descuentos),
    cantidadEmpleados: toNumber(row.cantidad_empleados),
    cantidadJubilados: toNumber(row.cantidad_jubilados)
  };
};

module.exports = { preview, generar, validar, limpiar, resumen };
