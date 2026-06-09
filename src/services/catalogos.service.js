const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { upperCaseFields } = require("../utils/text");

// Valores controlados para parametros de planilla (Version IV)
const ESTADOS_PLANILLA = ["GRABADO", "GENERADO", "APROBADO"];
const FRECUENCIAS_PLANILLA = ["MENSUAL", "QUINCENAL", "ANUAL", "TEMPORAL"];

const catalogs = {
  bancos: {
    dir: "bancos",
    required: ["nombre"],
    upperFields: ["nombre"],
    toDb: (data) => [data.nombre, data.estado || "ACTIVO"],
    toResponse: (row) => ({ id: row.ban_id, nombre: row.ban_nombre, estado: row.ban_estado, fechaCreacion: row.ban_fecha_creacion, usuarioCreacion: row.ban_usuario_creacion })
  },
  areas: {
    dir: "areas",
    required: ["descripcion"],
    upperFields: ["descripcion"],
    toDb: (data) => [data.descripcion],
    toResponse: (row) => ({ id: row.are_id, descripcion: row.are_descripcion, fechaCreacion: row.are_fecha_creacion, usuarioCreacion: row.are_usuario_creacion })
  },
  "manejo-administracion": {
    dir: "manejo-administracion",
    required: ["descripcion"],
    upperFields: ["descripcion"],
    toDb: (data) => [data.descripcion],
    toResponse: (row) => ({ id: row.man_id, descripcion: row.man_descripcion, fechaCreacion: row.man_fecha_creacion, usuarioCreacion: row.man_usuario_creacion })
  },
  puestos: {
    dir: "puestos",
    required: ["tipoManejo", "nombre", "funcion", "idArea"],
    upperFields: ["nombre", "funcion"],
    toDb: (data) => [data.tipoManejo, data.nombre, data.funcion, data.idArea],
    toResponse: (row) => ({
      id: row.pue_id,
      tipoManejo: row.pue_tipo_manejo,
      nombre: row.pue_nombre,
      funcion: row.pue_funcion,
      idArea: row.pue_id_area,
      areaDescripcion: row.area_descripcion,
      manejoDescripcion: row.manejo_descripcion,
      fechaCreacion: row.pue_fecha_creacion,
      usuarioCreacion: row.pue_usuario_creacion
    })
  },
  "tipo-ingreso": {
    dir: "tipo-ingreso",
    required: ["tipoIngreso", "descripcion"],
    upperFields: ["tipoIngreso", "descripcion"],
    toDb: (data) => [data.tipoIngreso, data.descripcion],
    toResponse: (row) => ({ id: row.tin_id, tipoIngreso: row.tin_tipo_ingreso, descripcion: row.tin_descripcion, fechaCreacion: row.tin_fecha_creacion, usuarioCreacion: row.tin_usuario_creacion })
  },
  "tipo-descuento": {
    dir: "tipo-descuento",
    required: ["tipoDescuento", "descripcion"],
    upperFields: ["tipoDescuento", "descripcion"],
    toDb: (data) => [data.tipoDescuento, data.descripcion],
    toResponse: (row) => ({ id: row.tde_id, tipoDescuento: row.tde_tipo_descuento, descripcion: row.tde_descripcion, fechaCreacion: row.tde_fecha_creacion, usuarioCreacion: row.tde_usuario_creacion })
  },
  "tipo-jubilacion": {
    dir: "tipo-jubilacion",
    required: ["descripcion"],
    upperFields: ["descripcion"],
    toDb: (data) => [data.descripcion],
    toResponse: (row) => ({ id: row.tju_id, descripcion: row.tju_descripcion, fechaCreacion: row.tju_fecha_creacion, usuarioCreacion: row.tju_usuario_creacion })
  },
  "tipo-planilla": {
    dir: "tipo-planilla",
    required: ["descripcion", "idTipoUso"],
    upperFields: ["descripcion"],
    toDb: (data) => ["1", data.descripcion, data.idTipoUso],
    toResponse: (row) => ({ id: row.tpl_id, tipoPlanilla: row.tpl_tipo_planilla, descripcion: row.tpl_descripcion, idTipoUso: row.tpl_id_tipo_uso, tipoUsoDescripcion: row.tipo_uso_descripcion, fechaCreacion: row.tpl_fecha_creacion, usuarioCreacion: row.tpl_usuario_creacion })
  },
  "parametro-general": {
    dir: "parametro-general",
    required: ["nombreEmpresa", "nit", "telefono", "correo"],
    // El correo NO se convierte a mayusculas (regla Version IV).
    upperFields: ["nombreEmpresa"],
    toDb: (data) => [data.nombreEmpresa, data.nit, data.telefono, data.correo, data.iva || 0, data.porcentajePagos || 0, data.isr || 0, data.porcentajeTiempoExtra || 0, data.pagoDieta || 0],
    toResponse: (row) => ({
      id: row.par_id,
      nombreEmpresa: row.par_nombre_empresa,
      nit: row.par_nit,
      telefono: row.par_telefono,
      correo: row.par_correo,
      iva: row.par_iva,
      porcentajePagos: row.par_porcentaje_pagos,
      isr: row.par_isr,
      porcentajeTiempoExtra: row.par_porcentaje_tiempo_extra,
      pagoDieta: row.par_pago_dieta,
      fechaCreacion: row.par_fecha_creacion,
      usuarioCreacion: row.par_usuario_creacion
    })
  },
  "firma-planilla": {
    dir: "firma-planilla",
    required: ["tipoManejo", "idFirma", "nombre", "puesto", "tipo"],
    upperFields: ["nombre", "puesto", "tipo"],
    toDb: (data) => [data.tipoManejo, data.idFirma, data.nombre, data.puesto, data.tipo],
    toResponse: (row) => ({
      id: row.fpl_correlativo,
      tipoManejo: row.fpl_tipo_manejo,
      idFirma: row.fpl_id,
      nombre: row.fpl_nombre,
      puesto: row.fpl_puesto,
      tipo: row.fpl_tipo,
      manejoDescripcion: row.manejo_descripcion,
      fechaCreacion: row.fpl_fecha_creacion,
      usuarioCreacion: row.fpl_usuario_creacion
    })
  },
  "parametro-planilla": {
    dir: "parametro-planilla",
    required: ["tipoPlanilla", "numero", "fechaInicio", "fechaFinal", "fechaPago", "frecuencia", "estado"],
    upperFields: ["frecuencia", "estado"],
    validate: (data) => {
      if (!ESTADOS_PLANILLA.includes(String(data.estado || "").toUpperCase())) {
        const error = new Error(`Estado no permitido. Use: ${ESTADOS_PLANILLA.join(", ")}`);
        error.status = 400;
        throw error;
      }
      if (!FRECUENCIAS_PLANILLA.includes(String(data.frecuencia || "").toUpperCase())) {
        const error = new Error(`Frecuencia no permitida. Use: ${FRECUENCIAS_PLANILLA.join(", ")}`);
        error.status = 400;
        throw error;
      }
    },
    toDb: (data) => [data.tipoPlanilla, data.numero, data.fechaInicio, data.fechaFinal, data.fechaPago, data.frecuencia, data.estado],
    toResponse: (row) => ({
      id: row.ppl_correlativo,
      tipoPlanilla: row.ppl_tipo_planilla,
      numero: row.ppl_numero,
      fechaInicio: row.ppl_fecha_inicio,
      fechaFinal: row.ppl_fecha_final,
      fechaPago: row.ppl_fecha_pago,
      frecuencia: row.ppl_frecuencia,
      estado: row.ppl_estado,
      tipoPlanillaNombre: row.tpl_tipo_planilla,
      tipoPlanillaDescripcion: row.tipo_planilla_descripcion,
      fechaCreacion: row.ppl_fecha_creacion,
      usuarioCreacion: row.ppl_usuario_creacion
    })
  }
};

const getCatalog = (catalogKey) => {
  const catalog = catalogs[catalogKey];
  if (!catalog) {
    const error = new Error("Catalogo no encontrado");
    error.status = 404;
    throw error;
  }
  return catalog;
};

const getQuery = (catalog, fileName) => getSql(`catalogos/${catalog.dir}/${fileName}.sql`);

const validatePayload = (catalog, payload) => {
  catalog.required.forEach((field) => {
    const value = payload[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      const error = new Error(`El campo ${field} es obligatorio`);
      error.status = 400;
      throw error;
    }
  });
  if (typeof catalog.validate === "function") {
    catalog.validate(payload);
  }
};

// Convierte a MAYUSCULAS los campos de texto configurados para el catalogo (Version IV).
const normalizePayload = (catalog, payload) => (catalog.upperFields ? upperCaseFields(payload, catalog.upperFields) : payload);

const list = async (catalogKey) => {
  const catalog = getCatalog(catalogKey);
  logger.info("Listado de catalogo solicitado", { catalogo: catalogKey });
  const [rows] = await pool.execute(getQuery(catalog, "listar"));
  return rows.map(catalog.toResponse);
};

const getById = async (catalogKey, id) => {
  const catalog = getCatalog(catalogKey);
  const [rows] = await pool.execute(getQuery(catalog, "obtenerPorId"), [id]);
  if (!rows[0]) {
    const error = new Error("Registro no encontrado");
    error.status = 404;
    throw error;
  }
  return catalog.toResponse(rows[0]);
};

const create = async (catalogKey, payload, currentUser) => {
  const catalog = getCatalog(catalogKey);
  const data = normalizePayload(catalog, payload);
  validatePayload(catalog, data);
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(getQuery(catalog, "crear"), [...catalog.toDb(data), createdBy]);
  logger.info("Registro de catalogo creado", { catalogo: catalogKey, id: result.insertId, createdBy });
  return getById(catalogKey, result.insertId);
};

const update = async (catalogKey, id, payload, currentUser) => {
  const catalog = getCatalog(catalogKey);
  const data = normalizePayload(catalog, payload);
  validatePayload(catalog, data);
  await getById(catalogKey, id);
  await pool.execute(getQuery(catalog, "actualizar"), [...catalog.toDb(data), id]);
  logger.info("Registro de catalogo actualizado", { catalogo: catalogKey, id, updatedBy: currentUser?.usuario });
  return getById(catalogKey, id);
};

const remove = async (catalogKey, id, currentUser) => {
  const catalog = getCatalog(catalogKey);
  await getById(catalogKey, id);

  try {
    await pool.execute(getQuery(catalog, "eliminar"), [id]);
    logger.info("Registro de catalogo eliminado", { catalogo: catalogKey, id, deletedBy: currentUser?.usuario });
    return { id: Number(id) };
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED" || error.code === "ER_ROW_IS_REFERENCED_2") {
      const fkError = new Error("No se puede eliminar porque el registro esta siendo utilizado");
      fkError.status = 409;
      logger.warn("No se pudo eliminar catalogo por relacion existente", { catalogo: catalogKey, id });
      throw fkError;
    }
    logger.error("Error al eliminar catalogo", { catalogo: catalogKey, id, message: error.message, code: error.code });
    throw error;
  }
};

module.exports = { list, getById, create, update, remove };
