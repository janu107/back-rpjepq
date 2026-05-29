const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { upperCaseFields } = require("../utils/text");

const TIPOS_HORA = ["DIURNA", "NOCTURNA", "MIXTA", "FERIADO"];

const configs = {
  salarios: {
    dir: "salarios",
    required: ["tipoManejo", "tipoIngreso", "salario"],
    validate: (data) => validateAmount(data.salario, "Salario"),
    toDb: (data) => [data.tipoManejo, data.tipoIngreso, data.salario],
    toResponse: (row) => ({
      id: row.sal_correlativo,
      tipoManejo: row.sal_tipo_manejo,
      tipoIngreso: row.sal_tipo_ingreso,
      salario: Number(row.sal_salario),
      manejoDescripcion: row.manejo_descripcion,
      tipoIngresoNombre: row.tin_tipo_ingreso,
      tipoIngresoDescripcion: row.tipo_ingreso_descripcion,
      fechaCreacion: row.sal_fecha_creacion,
      usuarioCreacion: row.sal_usuario_creacion
    })
  },
  "tiempo-extra": {
    dir: "tiempo-extra",
    required: ["idEmpleado", "fechaHoraInicio", "fechaHoraFinal", "motivo", "tipoHora"],
    upperFields: ["motivo", "tipoHora"],
    validate: (data) => {
      validateDate(data.fechaHoraInicio, "Fecha/hora inicio");
      validateDate(data.fechaHoraFinal, "Fecha/hora final");
      if (new Date(data.fechaHoraFinal) <= new Date(data.fechaHoraInicio)) throw createError("Fecha final debe ser mayor a fecha inicio");
      if (!TIPOS_HORA.includes(String(data.tipoHora || "").toUpperCase())) throw createError("Tipo hora no permitido");
    },
    normalize: (data) => ({
      ...data,
      tipoHora: String(data.tipoHora).toUpperCase(),
      // Version IV: el backend SIEMPRE recalcula las horas a partir de las fechas
      // para evitar manipulacion desde el frontend.
      cantidadHoras: calculateHours(data.fechaHoraInicio, data.fechaHoraFinal)
    }),
    toDb: (data) => [data.idEmpleado, data.fechaHoraInicio, data.fechaHoraFinal, data.cantidadHoras, data.motivo, data.tipoHora],
    toResponse: (row) => ({
      id: row.tex_correlativo,
      idEmpleado: row.tex_id_empleado,
      fechaHoraInicio: row.tex_fecha_hora_inicio,
      fechaHoraFinal: row.tex_fecha_hora_final,
      cantidadHoras: Number(row.tex_cantidad_horas),
      motivo: row.tex_motivo,
      tipoHora: row.tex_tipo_hora,
      empleadoNombre: `${row.emp_nombres || ""} ${row.emp_apellidos || ""}`.trim(),
      empleadoDpi: row.emp_dpi,
      fechaCreacion: row.tex_fecha_creacion,
      usuarioCreacion: row.tex_usuario_creacion
    })
  },
  dietas: {
    dir: "dietas",
    required: ["idJuntaDirectiva", "fechaSesion", "fechaPago", "sesionesMes", "acta", "valor", "retencionIsr", "liquido", "total"],
    upperFields: ["acta"],
    // Version IV: el backend calcula valor/retencion/liquido/total desde los parametros
    // generales. El usuario solo envia miembro, fechas, sesiones y acta.
    prepare: async (data) => {
      const { pagoDieta, isr } = await getParametrosDieta();
      return { ...data, ...computeDieta(pagoDieta, isr, data.sesionesMes) };
    },
    validate: (data) => {
      validateDate(data.fechaSesion, "Fecha sesion");
      validateDate(data.fechaPago, "Fecha pago");
      ["sesionesMes", "valor", "retencionIsr", "liquido", "total"].forEach((field) => validateAmount(data[field], field));
    },
    toDb: (data) => [data.idJuntaDirectiva, data.fechaSesion, data.fechaPago, data.sesionesMes, data.acta, data.valor, data.retencionIsr, data.liquido, data.total],
    toResponse: (row) => ({
      id: row.die_correlativo,
      idJuntaDirectiva: row.die_id_junta_directiva,
      fechaSesion: row.die_fecha_sesion,
      fechaPago: row.die_fecha_pago,
      sesionesMes: row.die_sesiones_mes,
      acta: row.die_acta,
      valor: Number(row.die_valor),
      retencionIsr: Number(row.die_retencion_isr),
      liquido: Number(row.die_liquido),
      total: Number(row.die_total),
      juntaNombre: `${row.jun_nombre || ""} ${row.jun_apellidos || ""}`.trim(),
      juntaPuesto: row.jun_puesto,
      fechaCreacion: row.die_fecha_creacion,
      usuarioCreacion: row.die_usuario_creacion
    })
  },
  "otros-descuentos": {
    dir: "otros-descuentos",
    required: ["tipoManejo", "tipoDescuento", "valor", "motivo", "fecha"],
    upperFields: ["motivo"],
    validate: (data) => {
      validateAmount(data.valor, "Valor");
      validateDate(data.fecha, "Fecha");
    },
    toDb: (data) => [data.tipoManejo, data.tipoDescuento, data.valor, data.motivo, data.fecha],
    toResponse: (row) => ({
      id: row.ode_correlativo,
      tipoManejo: row.ode_tipo_manejo,
      tipoDescuento: row.ode_tipo_descuento,
      valor: Number(row.ode_valor),
      motivo: row.ode_motivo,
      fecha: row.ode_fecha,
      manejoDescripcion: row.manejo_descripcion,
      tipoDescuentoNombre: row.tde_tipo_descuento,
      tipoDescuentoDescripcion: row.tipo_descuento_descripcion,
      fechaCreacion: row.ode_fecha_creacion,
      usuarioCreacion: row.ode_usuario_creacion
    })
  }
};

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const validateAmount = (value, label) => {
  if (value === undefined || value === null || Number(value) < 0) throw createError(`${label} debe ser mayor o igual a 0`);
};

const validateDate = (value, label) => {
  if (!value || Number.isNaN(Date.parse(value))) throw createError(`${label} invalida`);
};

// Version IV: la columna tex_cantidad_horas es INT, por lo que se redondea hacia
// arriba cualquier fraccion de hora. Devuelve 0 cuando el rango no es valido
// (lo captura luego validateDate / la regla "final > inicio").
const calculateHours = (start, end) => {
  const diffMs = new Date(end) - new Date(start);
  if (!(diffMs > 0)) return 0;
  return Math.ceil(diffMs / 3600000);
};

// Version IV (Pago de dietas): los montos se calculan desde RPJ_CAT_PARAMETRO_GENERAL.
const getParametrosDieta = async () => {
  const [rows] = await pool.execute(getSql("dietas/parametrosDieta.sql"));
  if (!rows[0]) {
    throw createError("No hay parametros generales configurados.", 400);
  }
  return { pagoDieta: Number(rows[0].par_pago_dieta || 0), isr: Number(rows[0].par_isr || 0) };
};

const computeDieta = (pagoDieta, isr, sesionesMes) => {
  const sesiones = Number(sesionesMes) > 0 ? Number(sesionesMes) : 1;
  const valor = Number((pagoDieta * sesiones).toFixed(2));
  const retencionIsr = Number((valor * isr / 100).toFixed(2));
  const liquido = Number((valor - retencionIsr).toFixed(2));
  // die_total es NOT NULL en la BD pero ya no se muestra al usuario: se guarda = liquido.
  return { valor, retencionIsr, liquido, total: liquido };
};

const getQuery = (config, file) => getSql(`${config.dir}/${file}.sql`);

const applyDefaultManejo = async (key, payload) => {
  if (!["salarios"].includes(key) || payload.tipoManejo) return payload;
  const [rows] = await pool.execute(getSql("catalogos/manejo-administracion/buscarEmpleadoRegimen.sql"));
  if (!rows[0]) {
    logger.warn("No existe manejo EMPLEADO REGIMEN");
    return payload;
  }
  return { ...payload, tipoManejo: rows[0].man_id };
};

const validatePayload = (config, payload) => {
  config.required.forEach((field) => {
    if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === "") {
      throw createError(`El campo ${field} es obligatorio`);
    }
  });
  config.validate(payload);
};

const assertUniqueSalaryTypesInPayload = (items) => {
  const seen = new Set();
  items.forEach((item) => {
    const key = `${item.tipoManejo}-${item.tipoIngreso}`;
    if (seen.has(key)) {
      throw createError("El tipo de ingreso no se puede repetir para el mismo manejo", 409);
    }
    seen.add(key);
  });
};

const salaryTypeExists = async (data, executor = pool) => {
  const [rows] = await executor.execute(getSql("salarios/buscarDuplicado.sql"), [
    data.tipoManejo,
    data.tipoIngreso,
    null,
    null
  ]);
  return rows.length > 0;
};

const ensureUniqueSalaryType = async (data, excludeId = null, executor = pool) => {
  const [rows] = await executor.execute(getSql("salarios/buscarDuplicado.sql"), [
    data.tipoManejo,
    data.tipoIngreso,
    excludeId,
    excludeId
  ]);
  if (rows.length > 0) {
    throw createError("El tipo de ingreso ya existe para este manejo", 409);
  }
};

// Convierte a MAYUSCULAS los campos de texto configurados (Version IV).
const applyUpper = (config, data) => (config.upperFields ? upperCaseFields(data, config.upperFields) : data);

const list = async (key) => {
  const config = configs[key];
  logger.info("Listado modulo admin pagos", { modulo: key });
  const [rows] = await pool.execute(getQuery(config, "listar"));
  return rows.map(config.toResponse);
};

const getById = async (key, id) => {
  const config = configs[key];
  const [rows] = await pool.execute(getQuery(config, "obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Registro no encontrado", 404);
  return config.toResponse(rows[0]);
};

const create = async (key, payload, currentUser) => {
  const config = configs[key];
  const withDefault = await applyDefaultManejo(key, payload);
  const prepared = config.prepare ? await config.prepare(withDefault) : withDefault;
  const data = applyUpper(config, config.normalize ? config.normalize(prepared) : prepared);
  validatePayload(config, data);
  if (key === "salarios") {
    await ensureUniqueSalaryType(data);
  }
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(getQuery(config, "crear"), [...config.toDb(data), createdBy]);
  logger.info("Registro admin pagos creado", { modulo: key, id: result.insertId, createdBy });
  return getById(key, result.insertId);
};

const bulkCreate = async (key, items = [], currentUser) => {
  const config = configs[key];
  if (!Array.isArray(items) || items.length === 0) {
    throw createError("Debe enviar al menos un registro");
  }

  const withDefaults = await Promise.all(items.map((payload) => applyDefaultManejo(key, payload)));
  const preparedItems = config.prepare ? await Promise.all(withDefaults.map((payload) => config.prepare(payload))) : withDefaults;
  const normalizedItems = preparedItems.map((payload) => applyUpper(config, config.normalize ? config.normalize(payload) : payload));
  normalizedItems.forEach((item) => validatePayload(config, item));
  if (key === "salarios") {
    assertUniqueSalaryTypesInPayload(normalizedItems);
  }

  const createdBy = currentUser?.usuario || "sistema";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [];
    let skipped = 0;
    for (const item of normalizedItems) {
      if (key === "salarios") {
        // Version IV: el salario es por manejo de administracion. Si la combinacion
        // (manejo, tipoIngreso) ya existe NO es un error: se omite para no bloquear
        // el alta de empleados/jubilados que comparten el mismo manejo.
        const exists = await salaryTypeExists(item, connection);
        if (exists) {
          skipped += 1;
          continue;
        }
      }
      try {
        const [result] = await connection.execute(getQuery(config, "crear"), [...config.toDb(item), createdBy]);
        ids.push(result.insertId);
      } catch (error) {
        // Salvaguarda: un duplicado de salario (por indice UNIQUE o concurrencia) se omite
        // en lugar de abortar todo el alta del empleado/jubilado.
        if (key === "salarios" && (error.code === "ER_DUP_ENTRY" || error.status === 409)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
    await connection.commit();
    logger.info("Registros admin pagos creados en lote", { modulo: key, total: ids.length, skipped, createdBy });
    return { total: ids.length, ids, skipped };
  } catch (error) {
    await connection.rollback();
    logger.error("Error al crear registros en lote", { modulo: key, message: error.message, code: error.code });
    throw error;
  } finally {
    connection.release();
  }
};

const update = async (key, id, payload, currentUser) => {
  const config = configs[key];
  const withDefault = await applyDefaultManejo(key, payload);
  const prepared = config.prepare ? await config.prepare(withDefault) : withDefault;
  const data = applyUpper(config, config.normalize ? config.normalize(prepared) : prepared);
  validatePayload(config, data);
  await getById(key, id);
  if (key === "salarios") {
    await ensureUniqueSalaryType(data, id);
  }
  await pool.execute(getQuery(config, "actualizar"), [...config.toDb(data), id]);
  logger.info("Registro admin pagos actualizado", { modulo: key, id, updatedBy: currentUser?.usuario });
  return getById(key, id);
};

const remove = async (key, id, currentUser) => {
  const config = configs[key];
  await getById(key, id);
  try {
    await pool.execute(getQuery(config, "eliminar"), [id]);
    logger.info("Registro admin pagos eliminado", { modulo: key, id, deletedBy: currentUser?.usuario });
    return { id: Number(id) };
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED" || error.code === "ER_ROW_IS_REFERENCED_2") throw createError("No se puede eliminar porque el registro esta siendo utilizado", 409);
    throw error;
  }
};

module.exports = { list, getById, create, bulkCreate, update, remove };
