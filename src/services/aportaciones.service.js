const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const ESTADOS = ["ACTIVO", "INACTIVO", "RETIRADO"];

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const validateDate = (value, label) => {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw createError(`${label} invalida`);
  }
};

const normalizeBool = (value) => (value === true || value === 1 || value === "1" ? 1 : 0);

const mapAportacion = (row) => ({
  id: row.apo_correlativo,
  tipoManejo: row.apo_tipo_manejo,
  idAportacion: row.apo_id,
  nombre: row.apo_nombre,
  apellido: row.apo_apellido,
  dpi: row.apo_dpi,
  gerencia: row.apo_gerencia,
  fechaInicioAportacion: row.apo_fecha_inicio_aportacion,
  fechaFinAportacion: row.apo_fecha_fin_aportacion,
  estado: row.apo_estado,
  tienePrestamo: Boolean(row.apo_tiene_prestamo),
  motivoRetiro: row.apo_motivo_retiro,
  fechaNacimiento: row.apo_fecha_nacimiento,
  ubicacion: row.apo_ubicacion,
  manejoDescripcion: row.manejo_descripcion,
  fechaCreacion: row.apo_fecha_creacion,
  usuarioCreacion: row.apo_usuario_creacion
});

const validatePayload = (data) => {
  ["tipoManejo", "idAportacion", "nombre", "apellido", "dpi", "gerencia", "fechaInicioAportacion", "estado", "fechaNacimiento", "ubicacion"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") {
      throw createError(`El campo ${field} es obligatorio`);
    }
  });

  if (!ESTADOS.includes(String(data.estado).toUpperCase())) {
    throw createError("Estado no permitido");
  }

  validateDate(data.fechaInicioAportacion, "Fecha inicio aportacion");
  if (data.fechaFinAportacion) validateDate(data.fechaFinAportacion, "Fecha fin aportacion");
  validateDate(data.fechaNacimiento, "Fecha nacimiento");
};

const ensureUniqueDpi = async (dpi, excludeId = null) => {
  const [rows] = await pool.execute(getSql("aportaciones/buscarPorDpi.sql"), [dpi]);
  if (rows.some((row) => Number(row.apo_correlativo) !== Number(excludeId))) {
    throw createError("Ya existe una aportacion con el mismo DPI", 409);
  }
};

const toDb = (data) => [
  data.tipoManejo,
  data.idAportacion,
  data.nombre,
  data.apellido,
  data.dpi,
  data.gerencia,
  data.fechaInicioAportacion,
  data.fechaFinAportacion || null,
  String(data.estado).toUpperCase(),
  normalizeBool(data.tienePrestamo),
  data.motivoRetiro || null,
  data.fechaNacimiento,
  data.ubicacion
];

const applyDefaultManejo = async (payload) => {
  if (payload.tipoManejo) return payload;
  const [rows] = await pool.execute(getSql("catalogos/manejo-administracion/buscarEmpleadoRegimen.sql"));
  if (!rows[0]) {
    logger.warn("No existe manejo EMPLEADO REGIMEN");
    return payload;
  }
  return { ...payload, tipoManejo: rows[0].man_id };
};

const list = async () => {
  logger.info("Listado de aportaciones solicitado");
  const [rows] = await pool.execute(getSql("aportaciones/listar.sql"));
  return rows.map(mapAportacion);
};

const getById = async (id) => {
  const [rows] = await pool.execute(getSql("aportaciones/obtenerPorId.sql"), [id]);
  if (!rows[0]) throw createError("Aportacion no encontrada", 404);
  return mapAportacion(rows[0]);
};

const create = async (payload, currentUser) => {
  const data = await applyDefaultManejo(payload);
  validatePayload(data);
  await ensureUniqueDpi(data.dpi);
  const createdBy = currentUser?.usuario || "sistema";
  const [result] = await pool.execute(getSql("aportaciones/crear.sql"), [...toDb(data), createdBy]);
  logger.info("Aportacion creada", { id: result.insertId, dpi: data.dpi, createdBy });
  return getById(result.insertId);
};

const update = async (id, payload, currentUser) => {
  const data = await applyDefaultManejo(payload);
  validatePayload(data);
  await getById(id);
  await ensureUniqueDpi(data.dpi, id);
  await pool.execute(getSql("aportaciones/actualizar.sql"), [...toDb(data), id]);
  logger.info("Aportacion actualizada", { id, updatedBy: currentUser?.usuario });
  return getById(id);
};

const changeStatus = async (id, estado, currentUser) => {
  if (!ESTADOS.includes(String(estado || "").toUpperCase())) throw createError("Estado no permitido");
  await getById(id);
  await pool.execute(getSql("aportaciones/cambiarEstado.sql"), [String(estado).toUpperCase(), id]);
  logger.info("Estado de aportacion actualizado", { id, estado, updatedBy: currentUser?.usuario });
  return getById(id);
};

const remove = async (id, currentUser) => {
  const aportacion = await getById(id);

  if (aportacion.tienePrestamo) {
    throw createError("No se puede eliminar porque el registro tiene prestamo relacionado", 409);
  }

  try {
    await pool.execute(getSql("aportaciones/eliminar.sql"), [id]);
    logger.info("Aportacion eliminada", { id, deletedBy: currentUser?.usuario });
    return { id: Number(id) };
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED" || error.code === "ER_ROW_IS_REFERENCED_2") {
      throw createError("No se puede eliminar porque el registro esta siendo utilizado", 409);
    }
    logger.error("Error al eliminar aportacion", { id, message: error.message, code: error.code });
    throw error;
  }
};

module.exports = { list, getById, create, update, changeStatus, remove };
