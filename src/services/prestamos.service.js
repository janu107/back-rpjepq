const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const ESTADOS = ["ACTIVO", "CANCELADO", "MORA", "ANULADO"];

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const mapPrestamo = (row) => ({
  id: row.pre_correlativo,
  idAportacion: row.pre_id_aportacion,
  noContrato: row.pre_no_contrato,
  montoAutorizado: Number(row.pre_monto_autorizado),
  cuotaNivelada: Number(row.pre_cuota_nivelada),
  plazoMeses: row.pre_plazo_meses,
  fechaInicio: row.pre_fecha_inicio,
  fechaFin: row.pre_fecha_fin,
  totalPagar: Number(row.pre_total_pagar),
  tasaInteres: Number(row.pre_tasa_interes),
  estado: row.pre_estado,
  tipoManejo: row.apo_tipo_manejo,
  aportacionNombre: `${row.apo_nombre || ""} ${row.apo_apellido || ""}`.trim(),
  aportacionDpi: row.apo_dpi,
  fechaCreacion: row.pre_fecha_creacion,
  usuarioCreacion: row.pre_usuario_creacion
});

const validatePayload = (data) => {
  ["idAportacion", "noContrato", "montoAutorizado", "cuotaNivelada", "plazoMeses", "fechaInicio", "fechaFin", "totalPagar", "tasaInteres", "estado"].forEach((field) => {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === "") throw createError(`El campo ${field} es obligatorio`);
  });
  if (Number(data.montoAutorizado) <= 0) throw createError("Monto autorizado debe ser mayor a 0");
  if (Number(data.plazoMeses) <= 0) throw createError("Plazo debe ser mayor a 0");
  if (Number(data.tasaInteres) < 0) throw createError("Tasa de interes no puede ser negativa");
  if (!ESTADOS.includes(String(data.estado).toUpperCase())) throw createError("Estado no permitido");
  if (Number.isNaN(Date.parse(data.fechaInicio)) || Number.isNaN(Date.parse(data.fechaFin))) throw createError("Fechas invalidas");
};

const ensureUniqueContract = async (noContrato, excludeId = null) => {
  const [rows] = await pool.execute(getSql("prestamos/buscarPorContrato.sql"), [noContrato]);
  if (rows.some((row) => Number(row.pre_correlativo) !== Number(excludeId))) throw createError("El numero de contrato ya existe", 409);
};

const toDb = (data) => [
  data.idAportacion,
  data.noContrato,
  data.montoAutorizado,
  data.cuotaNivelada,
  data.plazoMeses,
  data.fechaInicio,
  data.fechaFin,
  data.totalPagar,
  data.tasaInteres,
  String(data.estado).toUpperCase()
];

const list = async () => {
  logger.info("Listado de prestamos solicitado");
  const [rows] = await pool.execute(getSql("prestamos/listar.sql"));
  return rows.map(mapPrestamo);
};

const getById = async (id) => {
  const [rows] = await pool.execute(getSql("prestamos/obtenerPorId.sql"), [id]);
  if (!rows[0]) throw createError("Prestamo no encontrado", 404);
  return mapPrestamo(rows[0]);
};

const ensureNoActiveLoan = async (idAportacion, excludeId = null) => {
  const [rows] = await pool.execute(getSql("prestamos/buscarActivoPorAportacion.sql"), [idAportacion]);
  if (rows.some((row) => Number(row.pre_correlativo) !== Number(excludeId))) {
    throw createError("LA PERSONA YA CUENTA CON UN PRESTAMO ACTIVO", 409);
  }
};

const create = async (payload, currentUser) => {
  validatePayload(payload);
  if (["ACTIVO", "MORA"].includes(String(payload.estado).toUpperCase())) {
    await ensureNoActiveLoan(payload.idAportacion);
  }
  await ensureUniqueContract(payload.noContrato);
  const createdBy = currentUser?.usuario || "sistema";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(getSql("prestamos/crear.sql"), [...toDb(payload), createdBy]);
    await connection.execute(getSql("prestamos/actualizarTienePrestamoAportacion.sql"), [1, payload.idAportacion]);
    await connection.commit();
    logger.info("Prestamo creado", { id: result.insertId, contrato: payload.noContrato, createdBy });
    return getById(result.insertId);
  } catch (error) {
    await connection.rollback();
    logger.error("Error al crear prestamo", { message: error.message, code: error.code });
    throw error;
  } finally {
    connection.release();
  }
};

const update = async (id, payload, currentUser) => {
  validatePayload(payload);
  const current = await getById(id);
  if (Number(current.idAportacion) !== Number(payload.idAportacion) && ["ACTIVO", "MORA"].includes(String(payload.estado).toUpperCase())) {
    await ensureNoActiveLoan(payload.idAportacion, null);
  }
  await ensureUniqueContract(payload.noContrato, id);
  await pool.execute(getSql("prestamos/actualizar.sql"), [...toDb(payload), id]);
  await pool.execute(getSql("prestamos/actualizarTienePrestamoAportacion.sql"), [1, payload.idAportacion]);
  logger.info("Prestamo actualizado", { id, updatedBy: currentUser?.usuario });
  return getById(id);
};

const changeStatus = async (id, estado, currentUser) => {
  if (!ESTADOS.includes(String(estado || "").toUpperCase())) throw createError("Estado no permitido");
  await getById(id);
  await pool.execute(getSql("prestamos/cambiarEstado.sql"), [String(estado).toUpperCase(), id]);
  logger.info("Estado de prestamo actualizado", { id, estado, updatedBy: currentUser?.usuario });
  return getById(id);
};

const remove = async (id, currentUser) => {
  await getById(id);
  try {
    await pool.execute(getSql("prestamos/eliminar.sql"), [id]);
    logger.info("Prestamo eliminado", { id, deletedBy: currentUser?.usuario });
    return { id: Number(id) };
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED" || error.code === "ER_ROW_IS_REFERENCED_2") throw createError("No se puede eliminar porque el registro esta siendo utilizado", 409);
    throw error;
  }
};

const calculateInstallment = ({ montoAutorizado, tasaInteres, plazoMeses }) => {
  const principal = Number(montoAutorizado);
  const months = Number(plazoMeses);
  const annualRate = Number(tasaInteres);
  if (principal <= 0 || months <= 0 || annualRate < 0) throw createError("Datos invalidos para calcular cuota");
  const monthlyRate = annualRate / 100 / 12;
  const cuota = monthlyRate === 0 ? principal / months : principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
  const totalPagar = cuota * months;
  return {
    cuotaNivelada: Number(cuota.toFixed(2)),
    totalPagar: Number(totalPagar.toFixed(2)),
    interesTotalEstimado: Number((totalPagar - principal).toFixed(2))
  };
};

module.exports = { list, getById, create, update, changeStatus, remove, calculateInstallment };
