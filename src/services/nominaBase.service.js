const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const configs = {
  ingresos: {
    dir: "ingresos",
    idColumn: "nin_correlativo",
    tipoField: "tipoIngreso",
    toDb: (d) => [d.tipoManejo, d.idTipoPlanilla, d.idPlanilla, d.idEmpleado || null, d.idJubilado || null, d.tipoIngreso, d.valor, d.diasTrabajados, d.puesto, d.area],
    toResponse: (r) => ({
      id: r.nin_correlativo, tipoManejo: r.nin_tipo_manejo, idTipoPlanilla: r.nin_id_tipo_planilla, idPlanilla: r.nin_id_planilla,
      idEmpleado: r.nin_id_empleado, idJubilado: r.nin_id_jubilado, tipoIngreso: r.nin_tipo_ingreso, valor: Number(r.nin_valor),
      diasTrabajados: r.nin_dias_trabajados, puesto: r.nin_puesto, area: r.nin_area, manejoDescripcion: r.manejo_descripcion,
      tipoPlanilla: r.tpl_tipo_planilla, numeroPlanilla: r.numero_planilla, empleadoNombre: r.empleado_nombre, jubiladoNombre: r.jubilado_nombre,
      tipoIngresoNombre: r.tin_tipo_ingreso, tipoIngresoDescripcion: r.tipo_ingreso_descripcion, fechaCreacion: r.nin_fecha_creacion, usuarioCreacion: r.nin_usuario_creacion
    })
  },
  descuentos: {
    dir: "descuentos",
    idColumn: "nde_correlativo",
    tipoField: "tipoDescuento",
    toDb: (d) => [d.tipoManejo, d.idTipoPlanilla, d.idPlanilla, d.idEmpleado || null, d.idJubilado || null, d.tipoDescuento, d.valor, d.diasTrabajados, d.puesto, d.area],
    toResponse: (r) => ({
      id: r.nde_correlativo, tipoManejo: r.nde_tipo_manejo, idTipoPlanilla: r.nde_id_tipo_planilla, idPlanilla: r.nde_id_planilla,
      idEmpleado: r.nde_id_empleado, idJubilado: r.nde_id_jubilado, tipoDescuento: r.nde_tipo_descuento, valor: Number(r.nde_valor),
      diasTrabajados: r.nde_dias_trabajados, puesto: r.nde_puesto, area: r.nde_area, manejoDescripcion: r.manejo_descripcion,
      tipoPlanilla: r.tpl_tipo_planilla, numeroPlanilla: r.numero_planilla, empleadoNombre: r.empleado_nombre, jubiladoNombre: r.jubilado_nombre,
      tipoDescuentoNombre: r.tde_tipo_descuento, tipoDescuentoDescripcion: r.tipo_descuento_descripcion, fechaCreacion: r.nde_fecha_creacion, usuarioCreacion: r.nde_usuario_creacion
    })
  }
};

const createError = (message, status = 400) => { const error = new Error(message); error.status = status; return error; };
const getQuery = (config, file) => getSql(`nomina/${config.dir}/${file}.sql`);

const validate = (payload, config) => {
  ["tipoManejo", "idTipoPlanilla", "idPlanilla", config.tipoField, "valor", "diasTrabajados", "puesto", "area"].forEach((field) => {
    if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === "") throw createError(`El campo ${field} es obligatorio`);
  });
  if ((payload.idEmpleado && payload.idJubilado) || (!payload.idEmpleado && !payload.idJubilado)) throw createError("Debe indicar empleado o jubilado, pero no ambos");
  if (Number(payload.valor) < 0) throw createError("Valor debe ser mayor o igual a 0");
  if (Number(payload.diasTrabajados) < 0) throw createError("Dias trabajados debe ser mayor o igual a 0");
};

const list = async (key) => {
  const config = configs[key];
  logger.info(`Listado de nomina ${key}`);
  const [rows] = await pool.execute(getQuery(config, "listar"));
  return rows.map(config.toResponse);
};

const getById = async (key, id) => {
  const config = configs[key];
  const [rows] = await pool.execute(getQuery(config, "obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Registro no encontrado", 404);
  return config.toResponse(rows[0]);
};

const create = async (key, payload, user) => {
  const config = configs[key];
  validate(payload, config);
  try {
    const [result] = await pool.execute(getQuery(config, "crear"), [...config.toDb(payload), user?.usuario || "sistema"]);
    logger.info(`Registro de nomina ${key} creado`, { id: result.insertId });
    return getById(key, result.insertId);
  } catch (error) {
    if (error.code?.startsWith("ER_NO_REFERENCED_ROW")) throw createError("No se puede completar la accion porque hay datos relacionados invalidos", 400);
    throw error;
  }
};

const update = async (key, id, payload, user) => {
  const config = configs[key];
  validate(payload, config);
  await getById(key, id);
  try {
    await pool.execute(getQuery(config, "actualizar"), [...config.toDb(payload), id]);
    logger.info(`Registro de nomina ${key} actualizado`, { id, updatedBy: user?.usuario });
    return getById(key, id);
  } catch (error) {
    if (error.code?.startsWith("ER_NO_REFERENCED_ROW")) throw createError("No se puede completar la accion porque hay datos relacionados invalidos", 400);
    throw error;
  }
};

const remove = async (key, id, user) => {
  const config = configs[key];
  await getById(key, id);
  await pool.execute(getQuery(config, "eliminar"), [id]);
  logger.info(`Registro de nomina ${key} eliminado`, { id, deletedBy: user?.usuario });
  return { id: Number(id) };
};

const totalByPlanilla = async (key, idPlanilla) => {
  const config = configs[key];
  const [rows] = await pool.execute(getQuery(config, "totalPorPlanilla"), [idPlanilla]);
  return rows[0];
};

module.exports = { list, getById, create, update, remove, totalByPlanilla };
