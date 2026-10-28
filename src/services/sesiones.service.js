const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");
const { toISODate } = require("../utils/date");

// Módulo de Dietas (maestro-detalle):
//   RPJ_MNT_SESION       -> actas/reuniones de la junta directiva
//   RPJ_MNT_DIETA        -> encabezado de pago mensual por miembro (modelo vdi_*)
//   RPJ_MNT_DIETA_DET    -> asistencia individual (enlaza pago <-> sesión)
// Al registrar/editar una sesión se sincroniza la asistencia: por cada miembro
// presente se asegura su encabezado mensual (PENDIENTE) y se inserta el detalle
// con die_valor = par_pago_dieta vigente. Luego se recalculan los encabezados.

const MAX_SESIONES_MES = 5;
const TIPOS_JUNTA = ["JUNTA ADMINISTRADORA", "JUNTA VIGILANCIA"];

const sesionSql = (file) => getSql(`sesiones/${file}.sql`);
const dietaSql = (file) => getSql(`dietas/${file}.sql`);
const num = (v) => Number(v || 0);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const periodoDeFecha = (fecha) => String(fecha || "").slice(0, 7); // YYYY-MM

const mapSesion = (row) => ({
  id: row.ses_correlativo,
  acta: row.ses_acta,
  fechaSesion: toISODate(row.ses_fecha_sesion),
  descripcion: row.ses_descripcion,
  estado: row.ses_estado,
  tipoJunta: row.ses_tipo_junta || null,
  fechaAprobacion: row.ses_fecha_aprobacion || null,
  usuarioAprobacion: row.ses_usuario_aprobacion || null,
  asistentes: num(row.asistentes),
  fechaCreacion: row.ses_fecha_creacion,
  usuarioCreacion: row.ses_usuario_creacion
});

const getParametros = async (executor = pool) => {
  const [rows] = await executor.execute(dietaSql("parametrosVigentes"));
  if (!rows[0]) throw createError("No hay parámetros generales configurados (par_pago_dieta / par_isr).", 400);
  return { pagoDieta: num(rows[0].par_pago_dieta), isr: num(rows[0].par_isr) };
};

const list = async () => {
  const [rows] = await pool.execute(sesionSql("listar"));
  return rows.map(mapSesion);
};

const getById = async (id) => {
  const [rows] = await pool.execute(sesionSql("obtenerPorId"), [id]);
  if (!rows[0]) throw createError("Sesión no encontrada", 404);
  const sesion = mapSesion({ ...rows[0], asistentes: 0 });
  const [asis] = await pool.execute(sesionSql("asistenciaSesion"), [id]);
  sesion.asistentesIds = asis.map((a) => a.jun_id);
  sesion.asistentesDetalle = asis.map((a) => ({
    juntaId: a.jun_id,
    nombre: `${a.jun_nombre || ""} ${a.jun_apellidos || ""}`.trim(),
    puesto: a.jun_puesto
  }));
  return sesion;
};

const validate = (payload) => {
  if (!payload.acta || String(payload.acta).trim() === "") throw createError("El acta es obligatoria");
  if (!payload.fechaSesion) throw createError("La fecha de la sesión es obligatoria");
  if (Number.isNaN(Date.parse(payload.fechaSesion))) throw createError("Fecha de sesión inválida");
};

// Tipo de junta de la sesión. Obligatorio en sesiones nuevas; las sesiones
// registradas antes de este cambio pueden quedar sin tipo (asistencia mixta).
const tipoJuntaDe = (payload, obligatorio) => {
  const t = String(payload.tipoJunta || "").trim().toUpperCase();
  if (!t) {
    if (obligatorio) throw createError("Seleccione la junta (ADMINISTRADORA o VIGILANCIA)");
    return null;
  }
  if (!TIPOS_JUNTA.includes(t)) throw createError("Tipo de junta no válido");
  return t;
};

// Los asistentes deben pertenecer a la junta de la sesión.
const validarAsistentesJunta = async (conn, asistentes, tipoJunta) => {
  if (!tipoJunta) return;
  const ids = (Array.isArray(asistentes) ? asistentes : []).map(Number).filter((x) => x > 0);
  if (!ids.length) return;
  const [rows] = await conn.query(
    "SELECT jun_nombre, jun_apellidos, jun_tipo_junta FROM RPJ_MNT_JUNTA_DIRECTIVA WHERE jun_correlativo IN (?) AND COALESCE(jun_tipo_junta, '') <> ?",
    [ids, tipoJunta]
  );
  if (rows.length) {
    const r = rows[0];
    throw createError(`${`${r.jun_nombre || ""} ${r.jun_apellidos || ""}`.trim()} no pertenece a la ${tipoJunta}`, 400);
  }
};

// Asegura el encabezado PENDIENTE del miembro para el periodo (find-or-create).
const ensureEncabezado = async (conn, juntaId, periodo, usuario) => {
  const [found] = await conn.execute(dietaSql("buscarEncabezadoMes"), [juntaId, periodo]);
  if (found[0]) return found[0].vdi_correlativo;
  const [res] = await conn.execute(dietaSql("crearEncabezadoMin"), [juntaId, periodo, usuario]);
  return res.insertId;
};

// Sincroniza la asistencia de una sesión: limpia y re-inserta según `asistentes`,
// recalculando los encabezados afectados (los previos y los nuevos).
const syncAsistencia = async (conn, sesionId, periodo, asistentes, pagoDieta, usuario) => {
  const ids = Array.isArray(asistentes) ? [...new Set(asistentes.map((x) => Number(x)).filter((x) => x > 0))] : [];

  // Encabezados afectados ANTES del cambio (para recalcular aunque se les quite asistencia).
  const [prev] = await conn.execute(sesionSql("asistenciaSesion"), [sesionId]);

  // GUARDA: no se puede tocar la asistencia si algún encabezado afectado ya no
  // está PENDIENTE (PAGADO/RECIBIDO/ANULADO). El recálculo no toca pagos cerrados
  // y dejaría header y detalle inconsistentes (voucher pagado corrupto).
  const cerrado = prev.find((p) => p.vdi_estado && p.vdi_estado !== "PENDIENTE");
  if (cerrado) {
    throw createError(
      `No se puede modificar la asistencia: el pago de ${`${cerrado.jun_nombre || ""} ${cerrado.jun_apellidos || ""}`.trim()} ya está ${cerrado.vdi_estado}. Reverse el pago antes de editar.`,
      409
    );
  }

  const afectados = new Set(prev.map((p) => p.die_id_dieta));

  // Limpia la asistencia actual de la sesión y re-inserta la deseada.
  await conn.execute(sesionSql("eliminarDetallePorSesion"), [sesionId]);
  for (const juntaId of ids) {
    const idDieta = await ensureEncabezado(conn, juntaId, periodo, usuario);
    afectados.add(idDieta);
    await conn.execute(dietaSql("insertarDetalle"), [idDieta, sesionId, pagoDieta, usuario]);
  }

  // Recalcula cada encabezado afectado (solo recalcula los que están PENDIENTE).
  for (const idDieta of afectados) {
    await conn.execute(dietaSql("recalcularUno"), [idDieta, idDieta]);
  }
};

const create = async (payload, currentUser) => {
  validate(payload);
  const tipoJunta = tipoJuntaDe(payload, true);
  const usuario = currentUser?.usuario || "sistema";
  const periodo = periodoDeFecha(payload.fechaSesion);
  const { pagoDieta } = await getParametros();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Validaciones dentro de la transacción (acta única respaldada por UNIQUE;
    // máx 5 sesiones por mes y por junta es regla de negocio).
    const [dup] = await conn.execute(sesionSql("buscarActa"), [payload.acta, 0]);
    if (dup.length) throw createError("YA EXISTE UNA SESIÓN CON ESA ACTA", 409);
    const [cnt] = await conn.execute(sesionSql("contarMes"), [periodo, 0, tipoJunta, tipoJunta]);
    if (num(cnt[0]?.total) >= MAX_SESIONES_MES) {
      throw createError(`No se permiten más de ${MAX_SESIONES_MES} sesiones por mes para la ${tipoJunta}`, 409);
    }
    await validarAsistentesJunta(conn, payload.asistentes, tipoJunta);

    const [res] = await conn.execute(sesionSql("crear"), [
      String(payload.acta).toUpperCase(),
      payload.fechaSesion,
      payload.descripcion ? String(payload.descripcion).toUpperCase() : null,
      tipoJunta,
      usuario
    ]);
    const sesionId = res.insertId;
    await syncAsistencia(conn, sesionId, periodo, payload.asistentes, pagoDieta, usuario);
    await conn.commit();
    logger.info("Sesión de dietas creada", { sesionId, usuario, asistentes: (payload.asistentes || []).length });
    return getById(sesionId);
  } catch (error) {
    await conn.rollback();
    if (error.code === "ER_DUP_ENTRY") throw createError("YA EXISTE UNA SESIÓN CON ESA ACTA", 409);
    throw error;
  } finally {
    conn.release();
  }
};

const update = async (id, payload, currentUser) => {
  validate(payload);
  const usuario = currentUser?.usuario || "sistema";
  const periodo = periodoDeFecha(payload.fechaSesion);
  const existing = await getById(id);
  if (existing.estado === "APROBADA") throw createError("La sesión está APROBADA: su asistencia ya no se puede modificar", 409);
  if (existing.estado !== "ACTIVA") throw createError("Solo se pueden editar sesiones ACTIVAS", 409);
  // Una sesión que ya tiene junta no la pierde; las antiguas pueden quedar sin junta.
  const tipoJunta = tipoJuntaDe(payload, Boolean(existing.tipoJunta));

  const { pagoDieta } = await getParametros();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dup] = await conn.execute(sesionSql("buscarActa"), [payload.acta, id]);
    if (dup.length) throw createError("YA EXISTE UNA SESIÓN CON ESA ACTA", 409);
    const [cnt] = await conn.execute(sesionSql("contarMes"), [periodo, id, tipoJunta, tipoJunta]);
    if (num(cnt[0]?.total) >= MAX_SESIONES_MES) {
      throw createError(`No se permiten más de ${MAX_SESIONES_MES} sesiones por mes${tipoJunta ? ` para la ${tipoJunta}` : ""}`, 409);
    }
    await validarAsistentesJunta(conn, payload.asistentes, tipoJunta);

    await conn.execute(sesionSql("actualizar"), [
      String(payload.acta).toUpperCase(),
      payload.fechaSesion,
      payload.descripcion ? String(payload.descripcion).toUpperCase() : null,
      tipoJunta,
      id
    ]);
    await syncAsistencia(conn, id, periodo, payload.asistentes, pagoDieta, usuario);
    await conn.commit();
    logger.info("Sesión de dietas actualizada", { sesionId: id, usuario });
    return getById(id);
  } catch (error) {
    await conn.rollback();
    if (error.code === "ER_DUP_ENTRY") throw createError("YA EXISTE UNA SESIÓN CON ESA ACTA", 409);
    throw error;
  } finally {
    conn.release();
  }
};

// Anula la sesión (no se elimina) y recalcula los encabezados afectados para que
// los pagos PENDIENTE dejen de contar esa sesión.
const anular = async (id, currentUser) => {
  const existing = await getById(id);
  if (existing.estado === "ANULADA") throw createError("La sesión ya está anulada", 409);
  if (existing.estado === "APROBADA") throw createError("La sesión está APROBADA. Para anularla primero debe reabrirla (administrador).", 409);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [afect] = await conn.execute(sesionSql("asistenciaSesion"), [id]);

    // GUARDA: no anular si algún pago afectado ya no está PENDIENTE (quedaría
    // sobrevaluado porque el recálculo no toca pagos cerrados).
    const cerrado = afect.find((a) => a.vdi_estado && a.vdi_estado !== "PENDIENTE");
    if (cerrado) {
      throw createError(
        `No se puede anular: el pago de ${`${cerrado.jun_nombre || ""} ${cerrado.jun_apellidos || ""}`.trim()} ya está ${cerrado.vdi_estado}. Reverse el pago antes de anular la sesión.`,
        409
      );
    }

    await conn.execute(sesionSql("anular"), [id]);
    for (const a of afect) {
      await conn.execute(dietaSql("recalcularUno"), [a.die_id_dieta, a.die_id_dieta]);
    }
    await conn.commit();
    logger.info("Sesión de dietas anulada", { sesionId: id, usuario: currentUser?.usuario });
    return getById(id);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getAsistencia = async (id) => {
  const [rows] = await pool.execute(sesionSql("asistenciaSesion"), [id]);
  return rows.map((a) => ({
    idDetalle: a.die_correlativo,
    idDieta: a.die_id_dieta,
    juntaId: a.jun_id,
    periodo: a.vdi_periodo,
    nombre: `${a.jun_nombre || ""} ${a.jun_apellidos || ""}`.trim(),
    puesto: a.jun_puesto
  }));
};

// Aprobar: congela la asistencia (ya no se puede editar ni anular) y habilita
// emitir el pago de los asistentes.
const aprobar = async (id, currentUser) => {
  const existing = await getById(id);
  if (existing.estado !== "ACTIVA") throw createError(`Solo se aprueban sesiones ACTIVAS (esta está ${existing.estado})`, 409);
  if (!existing.asistentesIds.length) throw createError("La sesión no tiene asistentes registrados", 409);
  const usuario = currentUser?.usuario || "sistema";
  const [res] = await pool.execute(
    "UPDATE RPJ_MNT_SESION SET ses_estado = 'APROBADA', ses_fecha_aprobacion = NOW(), ses_usuario_aprobacion = ? WHERE ses_correlativo = ? AND ses_estado = 'ACTIVA'",
    [usuario, id]
  );
  if (res.affectedRows === 0) throw createError("La sesión cambió de estado, recargue e intente de nuevo", 409);
  logger.info("Sesión de dietas aprobada", { sesionId: id, usuario, asistentes: existing.asistentesIds.length });
  return getById(id);
};

// Reabrir (solo administrador): vuelve a ACTIVA para corregir la asistencia,
// siempre que no se haya emitido el pago de ninguno de sus asistentes.
const reabrir = async (id, currentUser) => {
  const existing = await getById(id);
  if (existing.estado !== "APROBADA") throw createError("Solo se reabren sesiones APROBADAS", 409);
  const [asis] = await pool.execute(sesionSql("asistenciaSesion"), [id]);
  const cerrado = asis.find((a) => a.vdi_estado && a.vdi_estado !== "PENDIENTE");
  if (cerrado) {
    throw createError(`No se puede reabrir: el pago de ${`${cerrado.jun_nombre || ""} ${cerrado.jun_apellidos || ""}`.trim()} ya está ${cerrado.vdi_estado}.`, 409);
  }
  await pool.execute(
    "UPDATE RPJ_MNT_SESION SET ses_estado = 'ACTIVA', ses_fecha_aprobacion = NULL, ses_usuario_aprobacion = NULL WHERE ses_correlativo = ? AND ses_estado = 'APROBADA'",
    [id]
  );
  logger.info("Sesión de dietas reabierta", { sesionId: id, usuario: currentUser?.usuario });
  return getById(id);
};

module.exports = { list, getById, create, update, anular, aprobar, reabrir, getAsistencia };
