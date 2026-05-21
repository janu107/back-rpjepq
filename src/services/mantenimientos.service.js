const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const ESTADOS = ["ACTIVO", "INACTIVO"];
const ESTADOS_CIVILES = ["SOLTERO", "CASADO", "UNIDO", "DIVORCIADO", "VIUDO"];
const TIPOS_PUESTO = ["ADMINISTRATIVO", "OPERATIVO", "TECNICO", "OTRO"];
const TIPOS_JUNTA = ["TITULAR", "SUPLENTE", "OTRO", "JUNTA ADMINISTRADORA", "JUNTA VIGILANCIA"];

const configs = {
  empleados: {
    dir: "empleados",
    idName: "empleado",
    required: ["tipoManejo", "idEmpleado", "nombres", "apellidos", "direccion", "dpi", "estadoCivil", "fechaNacimiento", "tipoPuesto", "idPuesto"],
    duplicateField: "dpi",
    duplicateColumn: "emp_correlativo",
    validate: (data) => {
      validateOption(data.estadoCivil, ESTADOS_CIVILES, "Estado civil no permitido");
      validateOption(data.tipoPuesto, TIPOS_PUESTO, "Tipo puesto no permitido");
      validateDate(data.fechaNacimiento, "Fecha de nacimiento invalida");
    },
    toDb: (data) => [
      data.tipoManejo,
      data.idEmpleado,
      data.nombres,
      data.apellidos,
      data.direccion,
      data.nit || null,
      data.dpi,
      data.estadoCivil,
      data.profesionOficio || null,
      data.fechaNacimiento,
      data.tipoPuesto,
      data.idPuesto
    ],
    toResponse: (row) => ({
      id: row.emp_correlativo,
      tipoManejo: row.emp_tipo_manejo,
      idEmpleado: row.emp_id,
      nombres: row.emp_nombres,
      apellidos: row.emp_apellidos,
      direccion: row.emp_direccion,
      nit: row.emp_nit,
      dpi: row.emp_dpi,
      estadoCivil: row.emp_estado_civil,
      profesionOficio: row.emp_profesion_oficio,
      fechaNacimiento: row.emp_fecha_nacimiento,
      tipoPuesto: row.emp_tipo_puesto,
      idPuesto: row.emp_id_puesto,
      manejoDescripcion: row.manejo_descripcion,
      puestoNombre: row.puesto_nombre,
      areaDescripcion: row.area_descripcion,
      fechaCreacion: row.emp_fecha_creacion,
      usuarioCreacion: row.emp_usuario_creacion
    })
  },
  jubilados: {
    dir: "jubilados",
    idName: "jubilado",
    required: ["tipoManejo", "idJubilado", "nombres", "apellidos", "fechaNacimiento", "dpi", "direccion", "estadoCivil", "estado", "fechaJubilacion", "tipoJubilacion"],
    duplicateField: "dpi",
    duplicateColumn: "jub_correlativo",
    validate: (data) => {
      validateOption(data.estadoCivil, ESTADOS_CIVILES, "Estado civil no permitido");
      validateOption(data.estado, ESTADOS, "Estado no permitido");
      validateDate(data.fechaNacimiento, "Fecha de nacimiento invalida");
      validateDate(data.fechaJubilacion, "Fecha de jubilacion invalida");
    },
    toDb: (data) => [
      data.tipoManejo,
      data.idJubilado,
      data.nombres,
      data.apellidos,
      data.fechaNacimiento,
      data.dpi,
      data.direccion,
      data.profesionOficio || null,
      data.estadoCivil,
      data.estado,
      data.fechaJubilacion,
      data.tipoJubilacion
    ],
    toResponse: (row) => ({
      id: row.jub_correlativo,
      tipoManejo: row.jub_tipo_manejo,
      idJubilado: row.jub_id,
      nombres: row.jub_nombres,
      apellidos: row.jub_apellidos,
      fechaNacimiento: row.jub_fecha_nacimiento,
      dpi: row.jub_dpi,
      direccion: row.jub_direccion,
      profesionOficio: row.jub_profesion_oficio,
      estadoCivil: row.jub_estado_civil,
      estado: row.jub_estado,
      fechaJubilacion: row.jub_fecha_jubilacion,
      tipoJubilacion: row.jub_tipo_jubilacion,
      manejoDescripcion: row.manejo_descripcion,
      tipoJubilacionDescripcion: row.tipo_jubilacion_descripcion,
      fechaCreacion: row.jub_fecha_creacion,
      usuarioCreacion: row.jub_usuario_creacion
    })
  },
  "junta-directiva": {
    dir: "junta-directiva",
    idName: "junta directiva",
    required: ["tipoManejo", "idJunta", "nombre", "apellidos", "tipoJunta", "nit", "puesto", "estado", "fechaInicio", "fechaFinal"],
    duplicateField: "nit",
    duplicateColumn: "jun_correlativo",
    validate: (data) => {
      validateOption(data.estado, ESTADOS, "Estado no permitido");
      validateOption(data.tipoJunta, TIPOS_JUNTA, "Tipo junta no permitido");
      validateDate(data.fechaInicio, "Fecha de inicio invalida");
      validateDate(data.fechaFinal, "Fecha final invalida");
    },
    toDb: (data) => [
      data.tipoManejo,
      data.idJunta,
      data.nombre,
      data.apellidos,
      data.tipoJunta,
      data.nit,
      data.puesto,
      data.estado,
      data.fechaInicio,
      data.fechaFinal
    ],
    toResponse: (row) => ({
      id: row.jun_correlativo,
      tipoManejo: row.jun_tipo_manejo,
      idJunta: row.jun_id,
      nombre: row.jun_nombre,
      apellidos: row.jun_apellidos,
      tipoJunta: row.jun_tipo_junta,
      nit: row.jun_nit,
      puesto: row.jun_puesto,
      estado: row.jun_estado,
      fechaInicio: row.jun_fecha_inicio,
      fechaFinal: row.jun_fecha_final,
      manejoDescripcion: row.manejo_descripcion,
      fechaCreacion: row.jun_fecha_creacion,
      usuarioCreacion: row.jun_usuario_creacion
    })
  }
};

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const validateOption = (value, options, message) => {
  if (!options.includes(String(value || "").toUpperCase())) {
    throw createError(message);
  }
};

const validateDate = (value, message) => {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw createError(message);
  }
};

const getConfig = (key) => configs[key];
const getQuery = (config, file) => getSql(`${config.dir}/${file}.sql`);

const applyDefaultManejo = async (key, payload) => {
  if (!["empleados"].includes(key) || payload.tipoManejo) return payload;
  const [rows] = await pool.execute(getSql("catalogos/manejo-administracion/buscarEmpleadoRegimen.sql"));
  if (!rows[0]) {
    logger.warn("No existe manejo EMPLEADO REGIMEN");
    return payload;
  }
  return { ...payload, tipoManejo: rows[0].man_id };
};

const validatePayload = (config, data) => {
  config.required.forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") {
      throw createError(`El campo ${field} es obligatorio`);
    }
  });

  const duplicateValue = data[config.duplicateField];
  if (!duplicateValue || String(duplicateValue).trim() === "") {
    throw createError("DPI/NIT no puede estar vacio");
  }

  config.validate(data);
};

const ensureUnique = async (config, value, excludeId = null) => {
  const [rows] = await pool.execute(getQuery(config, "buscarPorDpi"), [value]);
  if (rows.some((row) => Number(row[config.duplicateColumn]) !== Number(excludeId))) {
    throw createError("Ya existe un registro con el mismo DPI/NIT", 409);
  }
};

const list = async (key) => {
  const config = getConfig(key);
  logger.info("Listado de mantenimiento solicitado", { modulo: key });
  const [rows] = await pool.execute(getQuery(config, "listar"));
  return rows.map(config.toResponse);
};

const getById = async (key, id) => {
  const config = getConfig(key);
  const [rows] = await pool.execute(getQuery(config, "obtenerPorId"), [id]);
  if (!rows[0]) {
    throw createError("Registro no encontrado", 404);
  }
  return config.toResponse(rows[0]);
};

const create = async (key, payload, currentUser) => {
  const config = getConfig(key);
  const data = await applyDefaultManejo(key, payload);
  validatePayload(config, data);
  await ensureUnique(config, data[config.duplicateField]);
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(getQuery(config, "crear"), [...config.toDb(data), createdBy]);
  logger.info("Registro de mantenimiento creado", { modulo: key, id: result.insertId, createdBy });
  return getById(key, result.insertId);
};

const update = async (key, id, payload, currentUser) => {
  const config = getConfig(key);
  const data = await applyDefaultManejo(key, payload);
  validatePayload(config, data);
  await getById(key, id);
  await ensureUnique(config, data[config.duplicateField], id);
  await pool.execute(getQuery(config, "actualizar"), [...config.toDb(data), id]);
  logger.info("Registro de mantenimiento actualizado", { modulo: key, id, updatedBy: currentUser?.usuario });
  return getById(key, id);
};

const remove = async (key, id, currentUser) => {
  const config = getConfig(key);
  await getById(key, id);

  try {
    await pool.execute(getQuery(config, "eliminar"), [id]);
    logger.info("Registro de mantenimiento eliminado", { modulo: key, id, deletedBy: currentUser?.usuario });
    return { id: Number(id) };
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED" || error.code === "ER_ROW_IS_REFERENCED_2") {
      const fkError = createError("No se puede eliminar porque el registro esta siendo utilizado", 409);
      logger.warn("No se pudo eliminar mantenimiento por relacion existente", { modulo: key, id });
      throw fkError;
    }
    logger.error("Error al eliminar mantenimiento", { modulo: key, id, message: error.message, code: error.code });
    throw error;
  }
};

module.exports = {
  list,
  getById,
  create,
  update,
  remove
};
