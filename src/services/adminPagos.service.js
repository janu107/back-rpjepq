const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

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
    validate: (data) => {
      validateDate(data.fechaHoraInicio, "Fecha/hora inicio");
      validateDate(data.fechaHoraFinal, "Fecha/hora final");
      if (new Date(data.fechaHoraFinal) <= new Date(data.fechaHoraInicio)) throw createError("Fecha final debe ser mayor a fecha inicio");
      if (!TIPOS_HORA.includes(String(data.tipoHora || "").toUpperCase())) throw createError("Tipo hora no permitido");
    },
    normalize: (data) => ({
      ...data,
      tipoHora: String(data.tipoHora).toUpperCase(),
      cantidadHoras: data.cantidadHoras || calculateHours(data.fechaHoraInicio, data.fechaHoraFinal)
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

const calculateHours = (start, end) => Number(((new Date(end) - new Date(start)) / 3600000).toFixed(2));

const getQuery = (config, file) => getSql(`${config.dir}/${file}.sql`);

const validatePayload = (config, payload) => {
  config.required.forEach((field) => {
    if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === "") {
      throw createError(`El campo ${field} es obligatorio`);
    }
  });
  config.validate(payload);
};

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
  const data = config.normalize ? config.normalize(payload) : payload;
  validatePayload(config, data);
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(getQuery(config, "crear"), [...config.toDb(data), createdBy]);
  logger.info("Registro admin pagos creado", { modulo: key, id: result.insertId, createdBy });
  return getById(key, result.insertId);
};

const update = async (key, id, payload, currentUser) => {
  const config = configs[key];
  const data = config.normalize ? config.normalize(payload) : payload;
  validatePayload(config, data);
  await getById(key, id);
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

module.exports = { list, getById, create, update, remove };
