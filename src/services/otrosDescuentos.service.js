const logger = require("../config/logger");
const { pool } = require("../config/db");

// Otros descuentos (extraordinarios o de última hora) por persona y planilla.
// Cada registro dice a quién (empleado régimen o jubilado), en qué planilla
// (período AAAAMM) y cuánto. Los procesos que generan la nómina los agregan
// siempre que se genera esa planilla, también al reversar y generar de nuevo.
//   Manejo 1 = Empleados régimen -> planilla tipo 1 (NÓMINA RÉGIMEN)
//   Manejo 2 = Jubilados         -> planilla tipo 2 (NÓMINA JUBILADO)

const PLANILLA_DE_MANEJO = { 1: 1, 2: 2 };
const ESTADOS = ["ACTIVO", "ANULADO"];
const MES3 = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const periodoTexto = (p) => {
  const s = String(p || "");
  return s.length === 6 ? `${MES3[Number(s.slice(4, 6)) - 1]} ${s.slice(0, 4)}` : s;
};

const SELECT = `
  SELECT o.ode_correlativo, o.ode_tipo_manejo, o.ode_id_empleado, o.ode_id_jubilado, o.ode_periodo,
         o.ode_tipo_descuento, o.ode_valor, o.ode_motivo, o.ode_fecha, o.ode_estado,
         o.ode_fecha_creacion, o.ode_usuario_creacion, o.ode_fecha_modificacion, o.ode_usuario_modificacion,
         m.man_descripcion AS manejo_descripcion,
         td.tde_tipo_descuento, td.tde_descripcion AS tipo_descuento_descripcion,
         COALESCE(e.emp_id, j.jub_id) AS persona_codigo,
         TRIM(CONCAT(COALESCE(e.emp_nombres, j.jub_nombres, ''), ' ', COALESCE(e.emp_apellidos, j.jub_apellidos, ''))) AS persona_nombre,
         pl.ppl_correlativo AS planilla_id, pl.ppl_estado_proceso AS planilla_estado
    FROM RPJ_MNT_OTRO_DESCUENTO o
    LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = o.ode_tipo_manejo
    LEFT JOIN RPJ_CAT_TIPO_DESCUENTO td ON td.tde_id = o.ode_tipo_descuento
    LEFT JOIN RPJ_MNT_EMPLEADO e ON o.ode_tipo_manejo = 1 AND e.emp_correlativo = o.ode_id_empleado
    LEFT JOIN RPJ_MNT_JUBILADO j ON o.ode_tipo_manejo = 2 AND j.jub_correlativo = o.ode_id_jubilado
    LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA pl
           ON pl.ppl_tipo_planilla = CASE o.ode_tipo_manejo WHEN 1 THEN 1 WHEN 2 THEN 2 END
          AND pl.ppl_numero = o.ode_periodo`;

const mapRow = (r) => ({
  id: r.ode_correlativo,
  tipoManejo: r.ode_tipo_manejo,
  manejoDescripcion: r.manejo_descripcion,
  idPersona: r.ode_tipo_manejo === 1 ? r.ode_id_empleado : r.ode_id_jubilado,
  personaCodigo: r.persona_codigo,
  personaNombre: r.persona_nombre,
  periodo: r.ode_periodo,
  periodoTexto: periodoTexto(r.ode_periodo),
  tipoDescuento: r.ode_tipo_descuento,
  tipoDescuentoNombre: r.tde_tipo_descuento,
  tipoDescuentoDescripcion: r.tipo_descuento_descripcion,
  valor: Number(r.ode_valor),
  motivo: r.ode_motivo,
  fecha: r.ode_fecha,
  estado: r.ode_estado,
  // Estado de la planilla del período: sin crear, ABIERTA, GENERADA, REVERSADA o CERRADA.
  planillaId: r.planilla_id || null,
  planillaEstado: r.planilla_estado || "SIN CREAR",
  fechaCreacion: r.ode_fecha_creacion,
  usuarioCreacion: r.ode_usuario_creacion,
  fechaModificacion: r.ode_fecha_modificacion,
  usuarioModificacion: r.ode_usuario_modificacion
});

const list = async () => {
  const [rows] = await pool.query(`${SELECT} ORDER BY o.ode_periodo DESC, o.ode_correlativo DESC`);
  return rows.map(mapRow);
};

const getById = async (id) => {
  const [rows] = await pool.query(`${SELECT} WHERE o.ode_correlativo = ?`, [id]);
  if (!rows[0]) throw createError("Descuento no encontrado", 404);
  return mapRow(rows[0]);
};

const estadoPlanilla = async (tipoManejo, periodo) => {
  const [rows] = await pool.query(
    "SELECT ppl_correlativo, ppl_estado_proceso FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = ? AND ppl_numero = ? LIMIT 1",
    [PLANILLA_DE_MANEJO[tipoManejo], periodo]
  );
  return rows[0] ? rows[0].ppl_estado_proceso : null;
};

const assertNoCerrada = async (tipoManejo, periodo, accion) => {
  if ((await estadoPlanilla(tipoManejo, periodo)) === "CERRADA") {
    throw createError(`La planilla ${periodoTexto(periodo)} ya está CERRADA: no se puede ${accion} el descuento`, 409);
  }
};

const validar = async (payload) => {
  const tipoManejo = Number(payload.tipoManejo);
  if (!PLANILLA_DE_MANEJO[tipoManejo]) throw createError("Seleccione a quién aplica: Empleados régimen o Jubilados");
  const idPersona = Number(payload.idPersona);
  if (!idPersona) throw createError(tipoManejo === 1 ? "Seleccione el empleado" : "Seleccione el jubilado");
  const [persona] = tipoManejo === 1
    ? await pool.query("SELECT emp_correlativo FROM RPJ_MNT_EMPLEADO WHERE emp_correlativo = ? AND emp_tipo_manejo = 1", [idPersona])
    : await pool.query("SELECT jub_correlativo FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ? AND jub_tipo_manejo = 2", [idPersona]);
  if (!persona.length) throw createError(tipoManejo === 1 ? "El empleado no existe en Empleados régimen" : "El jubilado no existe");

  const periodo = Number(payload.periodo);
  if (!/^\d{6}$/.test(String(payload.periodo || "")) || periodo % 100 < 1 || periodo % 100 > 12) {
    throw createError("Seleccione la planilla a aplicar (año y mes)");
  }
  const tipoDescuento = Number(payload.tipoDescuento);
  const [td] = await pool.query("SELECT tde_id FROM RPJ_CAT_TIPO_DESCUENTO WHERE tde_id = ?", [tipoDescuento]);
  if (!td.length) throw createError("Seleccione el tipo de descuento");
  const valor = Math.round(Number(payload.valor) * 100) / 100;
  if (!(valor > 0)) throw createError("El valor debe ser mayor a 0");
  const motivo = String(payload.motivo || "").trim().toUpperCase();
  if (!motivo) throw createError("El motivo es obligatorio");
  const estado = String(payload.estado || "ACTIVO").toUpperCase();
  if (!ESTADOS.includes(estado)) throw createError("Estado no permitido");
  return { tipoManejo, idPersona, periodo, tipoDescuento, valor, motivo: motivo.slice(0, 200), estado };
};

// Aviso para la pantalla cuando la planilla del período ya está generada.
const aviso = async (tipoManejo, periodo) => {
  const estado = await estadoPlanilla(tipoManejo, periodo);
  return estado === "GENERADA"
    ? `La planilla ${periodoTexto(periodo)} ya está GENERADA: para que el cambio se aplique, reverse la planilla y genérela de nuevo.`
    : null;
};

const create = async (payload, currentUser) => {
  const d = await validar(payload);
  await assertNoCerrada(d.tipoManejo, d.periodo, "agregar");
  const usuario = currentUser?.usuario || "sistema";
  const [res] = await pool.query(
    `INSERT INTO RPJ_MNT_OTRO_DESCUENTO
       (ode_tipo_manejo, ode_id_empleado, ode_id_jubilado, ode_periodo, ode_tipo_descuento, ode_valor, ode_motivo, ode_fecha, ode_estado, ode_usuario_creacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
    [d.tipoManejo, d.tipoManejo === 1 ? d.idPersona : null, d.tipoManejo === 2 ? d.idPersona : null,
      d.periodo, d.tipoDescuento, d.valor, d.motivo, d.estado, usuario]
  );
  logger.info("Otro descuento creado", { id: res.insertId, periodo: d.periodo, usuario });
  return { ...(await getById(res.insertId)), aviso: await aviso(d.tipoManejo, d.periodo) };
};

const update = async (id, payload, currentUser) => {
  const actual = await getById(id);
  await assertNoCerrada(actual.tipoManejo, actual.periodo, "modificar");
  const d = await validar(payload);
  await assertNoCerrada(d.tipoManejo, d.periodo, "mover a esa planilla");
  const usuario = currentUser?.usuario || "sistema";
  await pool.query(
    `UPDATE RPJ_MNT_OTRO_DESCUENTO
        SET ode_tipo_manejo = ?, ode_id_empleado = ?, ode_id_jubilado = ?, ode_periodo = ?, ode_tipo_descuento = ?,
            ode_valor = ?, ode_motivo = ?, ode_estado = ?, ode_fecha_modificacion = NOW(), ode_usuario_modificacion = ?
      WHERE ode_correlativo = ?`,
    [d.tipoManejo, d.tipoManejo === 1 ? d.idPersona : null, d.tipoManejo === 2 ? d.idPersona : null,
      d.periodo, d.tipoDescuento, d.valor, d.motivo, d.estado, usuario, id]
  );
  logger.info("Otro descuento actualizado", { id, usuario });
  return { ...(await getById(id)), aviso: (await aviso(actual.tipoManejo, actual.periodo)) || (await aviso(d.tipoManejo, d.periodo)) };
};

const remove = async (id, currentUser) => {
  const actual = await getById(id);
  await assertNoCerrada(actual.tipoManejo, actual.periodo, "eliminar");
  await pool.query("DELETE FROM RPJ_MNT_OTRO_DESCUENTO WHERE ode_correlativo = ?", [id]);
  logger.info("Otro descuento eliminado", { id, usuario: currentUser?.usuario });
  return { id, aviso: await aviso(actual.tipoManejo, actual.periodo) };
};

module.exports = { list, getById, create, update, remove };
