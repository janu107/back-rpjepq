const logger = require("../config/logger");
const { pool } = require("../config/db");
const { createError } = require("../utils/planillaEstado");

// ============================================================================
// Servicio de Beneficiarios (y sus tutores) del módulo de Jubilados.
// Los beneficiarios pertenecen a un JUBILADO (ben_id_jubilado -> jub_correlativo)
// y cobran cuando el jubilado fallece, según su porcentaje.
// SQL en línea (el módulo es nuevo y autocontenido).
// ============================================================================

const PARENTESCOS = ["ESPOSA", "HIJO", "HIJO_INVALIDEZ"];
const toNum = (v) => Number(v || 0);

// Edad cumplida a partir de la fecha de nacimiento.
const edad = (fechaNac) => {
  const hoy = new Date();
  const n = new Date(fechaNac);
  let e = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) e -= 1;
  return e;
};

const esDpiValido = (dpi) => /^[0-9]{13}$/.test(String(dpi || "").trim());

const mapBeneficiario = (b) => ({
  id: b.id,
  idJubilado: b.idJubilado,
  tipoParentesco: b.tipoParentesco,
  nombres: b.nombres,
  apellidos: b.apellidos,
  dpi: b.dpi,
  fechaNacimiento: b.fechaNacimiento,
  porcentaje: toNum(b.porcentaje),
  telefono: b.telefono,
  correo: b.correo,
  estado: b.estado,
  empleadorEstatal: b.empleadorEstatal,
  fechaInicioEmpleo: b.fechaInicioEmpleo,
  edad: b.fechaNacimiento ? edad(b.fechaNacimiento) : null,
  esMenor: b.fechaNacimiento ? edad(b.fechaNacimiento) < 18 : false
});

// ---------------------------------------------------------------------------
// Autocomplete de jubilados (para elegir a quién registrar beneficiarios).
// ---------------------------------------------------------------------------
const buscarJubilados = async (q) => {
  const term = String(q || "").trim();
  if (term.length < (/^\d+$/.test(term) ? 1 : 3)) return [];
  const like = `%${term}%`;
  const [rows] = await pool.execute(
    `SELECT jub_correlativo AS id, jub_id AS idJubilado, jub_dpi AS dpi,
            CONCAT(jub_nombres, ' ', jub_apellidos) AS nombreCompleto,
            jub_estado AS estado, jub_tipo_pago AS tipoPago, jub_estado_pago AS estadoPago
       FROM RPJ_MNT_JUBILADO
      WHERE jub_estado = 'ACTIVO'
        AND (jub_id LIKE ? OR jub_nombres LIKE ? OR jub_apellidos LIKE ? OR jub_dpi LIKE ?
             OR CONCAT(jub_nombres, ' ', jub_apellidos) LIKE ?)
      ORDER BY jub_nombres, jub_apellidos
      LIMIT 20`,
    [like, like, like, like, like]
  );
  return rows;
};

const getJubilado = async (idJubilado) => {
  const [rows] = await pool.execute(
    `SELECT jub_correlativo AS id, jub_id AS idJubilado, jub_dpi AS dpi,
            CONCAT(jub_nombres, ' ', jub_apellidos) AS nombreCompleto,
            jub_estado AS estado, jub_tipo_pago AS tipoPago, jub_estado_pago AS estadoPago
       FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = ?`,
    [idJubilado]
  );
  if (!rows[0]) throw createError("Jubilado no encontrado", 404);
  return rows[0];
};

// ---------------------------------------------------------------------------
// Beneficiarios de un jubilado (con sus tutores).
// ---------------------------------------------------------------------------
const getByJubilado = async (idJubilado) => {
  const [rows] = await pool.execute(
    `SELECT ben_correlativo AS id, ben_id_jubilado AS idJubilado, ben_tipo_parentesco AS tipoParentesco,
            ben_nombres AS nombres, ben_apellidos AS apellidos, ben_dpi AS dpi,
            ben_fecha_nacimiento AS fechaNacimiento, ben_porcentaje AS porcentaje,
            ben_telefono AS telefono, ben_correo AS correo, ben_estado AS estado,
            ben_empleador_estatal AS empleadorEstatal, ben_fecha_inicio_empleo AS fechaInicioEmpleo
       FROM RPJ_MNT_BENEFICIARIO WHERE ben_id_jubilado = ? ORDER BY ben_correlativo`,
    [idJubilado]
  );
  const beneficiarios = rows.map(mapBeneficiario);
  if (beneficiarios.length) {
    const ids = beneficiarios.map((b) => b.id);
    const [tutores] = await pool.query(
      `SELECT tut_correlativo AS id, tut_id_beneficiario AS idBeneficiario, tut_nombres AS nombres,
              tut_apellidos AS apellidos, tut_dpi AS dpi, tut_parentesco AS parentesco, tut_telefono AS telefono,
              tut_fecha_inicio AS fechaInicio, tut_estado AS estado
         FROM RPJ_MNT_TUTOR WHERE tut_id_beneficiario IN (?) ORDER BY tut_correlativo`,
      [ids]
    );
    beneficiarios.forEach((b) => { b.tutores = tutores.filter((t) => t.idBeneficiario === b.id); });
  }
  return beneficiarios;
};

// ---------------------------------------------------------------------------
// Validación de un beneficiario individual del payload.
// ---------------------------------------------------------------------------
const validarBeneficiario = (b, idx) => {
  const etiqueta = `Beneficiario #${idx + 1}`;
  if (!PARENTESCOS.includes(String(b.tipoParentesco || "").toUpperCase())) {
    throw createError(`${etiqueta}: parentesco no válido (ESPOSA, HIJO o HIJO_INVALIDEZ)`);
  }
  if (!b.apellidos || String(b.apellidos).trim() === "") throw createError(`${etiqueta}: los apellidos son obligatorios`);
  if (!esDpiValido(b.dpi)) throw createError(`${etiqueta}: el DPI debe tener 13 dígitos`);
  if (!b.fechaNacimiento || Number.isNaN(Date.parse(b.fechaNacimiento))) throw createError(`${etiqueta}: fecha de nacimiento inválida`);
  if (new Date(b.fechaNacimiento) > new Date()) throw createError(`${etiqueta}: la fecha de nacimiento no puede ser futura`);
  const pct = toNum(b.porcentaje);
  if (pct <= 0 || pct > 100) throw createError(`${etiqueta}: el porcentaje debe estar entre 0.01 y 100`);
};

const validarTutora = (t, etiqueta) => {
  if (!t || typeof t !== "object") throw createError(`${etiqueta}: es menor de edad y requiere tutora`);
  if (!t.apellidos || String(t.apellidos).trim() === "") throw createError(`${etiqueta} (tutora): los apellidos son obligatorios`);
  if (!esDpiValido(t.dpi)) throw createError(`${etiqueta} (tutora): el DPI debe tener 13 dígitos`);
};

// ---------------------------------------------------------------------------
// Registro por lote: beneficiarios + sus tutoras, en una sola transacción.
// Reglas (validadas en backend, no sólo en el front):
//   - suma de % = 100.00 exacto
//   - máximo 1 ESPOSA
//   - DPI 13 dígitos, único dentro del lote y único por jubilado
//   - menores de 18 requieren tutora (embebida en cada beneficiario)
// ---------------------------------------------------------------------------
const registrarLote = async (payload, currentUser) => {
  const idJubilado = payload?.idJubilado;
  const beneficiarios = Array.isArray(payload?.beneficiarios) ? payload.beneficiarios : [];
  if (!idJubilado) throw createError("Debe indicar el jubilado (idJubilado)");
  if (!beneficiarios.length) throw createError("Debe registrar al menos un beneficiario");

  await getJubilado(idJubilado); // valida que exista

  // Validación individual
  beneficiarios.forEach(validarBeneficiario);

  // Suma de porcentajes = 100.00 exacto
  const suma = Math.round(beneficiarios.reduce((s, b) => s + toNum(b.porcentaje), 0) * 100) / 100;
  if (suma !== 100) throw createError(`La suma de porcentajes debe ser exactamente 100.00 (actual: ${suma.toFixed(2)})`);

  // Máximo 1 ESPOSA
  const esposas = beneficiarios.filter((b) => String(b.tipoParentesco).toUpperCase() === "ESPOSA").length;
  if (esposas > 1) throw createError("Solo se permite un beneficiario con parentesco ESPOSA");

  // DPI único dentro del lote
  const dpis = beneficiarios.map((b) => String(b.dpi).trim());
  if (new Set(dpis).size !== dpis.length) throw createError("Hay DPIs repetidos en el lote de beneficiarios");

  // DPI único por jubilado (contra lo ya guardado)
  const [existentes] = await pool.query(
    `SELECT ben_dpi FROM RPJ_MNT_BENEFICIARIO WHERE ben_id_jubilado = ? AND ben_dpi IN (?)`,
    [idJubilado, dpis]
  );
  if (existentes.length) throw createError(`El DPI ${existentes[0].ben_dpi} ya está registrado para este jubilado`);

  // Menores requieren tutora
  beneficiarios.forEach((b, idx) => {
    if (edad(b.fechaNacimiento) < 18) validarTutora(b.tutora, `Beneficiario #${idx + 1}`);
  });

  const usuario = currentUser?.usuario || "sistema";
  logger.info("Registrando lote de beneficiarios", { idJubilado, cantidad: beneficiarios.length, usuario });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const b of beneficiarios) {
      const [res] = await conn.execute(
        `INSERT INTO RPJ_MNT_BENEFICIARIO
           (ben_id_jubilado, ben_tipo_parentesco, ben_nombres, ben_apellidos, ben_dpi,
            ben_fecha_nacimiento, ben_porcentaje, ben_telefono, ben_correo, ben_estado, ben_fecha_registro, ben_usuario_creacion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REGISTRADO', CURDATE(), ?)`,
        [idJubilado, String(b.tipoParentesco).toUpperCase(), b.nombres || "", b.apellidos, String(b.dpi).trim(),
         b.fechaNacimiento, toNum(b.porcentaje), b.telefono || null, b.correo || null, usuario]
      );
      const idBen = res.insertId;
      if (b.tutora) {
        const t = b.tutora;
        await conn.execute(
          // La tutoría empieza al registrarla (o en la fecha indicada).
          `INSERT INTO RPJ_MNT_TUTOR
             (tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi, tut_parentesco, tut_telefono, tut_fecha_inicio, tut_usuario_creacion)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?)`,
          [idBen, t.nombres || "", t.apellidos, String(t.dpi).trim(), t.parentesco || null, t.telefono || null,
           /^\d{4}-\d{2}-\d{2}/.test(String(t.fechaInicio || "")) ? String(t.fechaInicio).slice(0, 10) : null, usuario]
        );
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return getByJubilado(idJubilado);
};

const remove = async (id, currentUser) => {
  const [rows] = await pool.execute("SELECT ben_id_jubilado FROM RPJ_MNT_BENEFICIARIO WHERE ben_correlativo = ?", [id]);
  if (!rows[0]) throw createError("Beneficiario no encontrado", 404);
  try {
    await pool.execute("DELETE FROM RPJ_MNT_BENEFICIARIO WHERE ben_correlativo = ?", [id]);
  } catch (e) {
    if (e.code === "ER_ROW_IS_REFERENCED" || e.code === "ER_ROW_IS_REFERENCED_2") {
      throw createError("No se puede eliminar: el beneficiario ya tiene deuda o pagos asociados", 409);
    }
    throw e;
  }
  logger.info("Beneficiario eliminado", { id, usuario: currentUser?.usuario });
  return { id: Number(id) };
};

// ---------------------------------------------------------------------------
// Edición de un beneficiario ya registrado (datos y su tutora). El porcentaje
// se cambia aparte (actualizarPorcentajes) porque entre todos deben sumar 100.
// ---------------------------------------------------------------------------
const fechaValida = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : null;
};

const actualizar = async (id, payload, currentUser) => {
  const [rows] = await pool.execute(
    "SELECT ben_correlativo, ben_id_jubilado, ben_porcentaje FROM RPJ_MNT_BENEFICIARIO WHERE ben_correlativo = ?", [id]
  );
  if (!rows[0]) throw createError("Beneficiario no encontrado", 404);
  const actual = rows[0];
  const b = { ...payload, porcentaje: actual.ben_porcentaje };
  validarBeneficiario(b, 0);
  const parentesco = String(b.tipoParentesco).toUpperCase();
  const dpi = String(b.dpi).trim();

  const [dup] = await pool.execute(
    "SELECT ben_correlativo FROM RPJ_MNT_BENEFICIARIO WHERE ben_id_jubilado = ? AND ben_dpi = ? AND ben_correlativo <> ?",
    [actual.ben_id_jubilado, dpi, id]
  );
  if (dup.length) throw createError(`El DPI ${dpi} ya está registrado en otro beneficiario de este jubilado`);
  if (parentesco === "ESPOSA") {
    const [esp] = await pool.execute(
      "SELECT ben_correlativo FROM RPJ_MNT_BENEFICIARIO WHERE ben_id_jubilado = ? AND ben_tipo_parentesco = 'ESPOSA' AND ben_correlativo <> ?",
      [actual.ben_id_jubilado, id]
    );
    if (esp.length) throw createError("Este jubilado ya tiene un beneficiario con parentesco ESPOSA");
  }
  const menor = edad(b.fechaNacimiento) < 18;
  const [tutVig] = await pool.execute(
    "SELECT tut_correlativo FROM RPJ_MNT_TUTOR WHERE tut_id_beneficiario = ? AND tut_estado = 'VIGENTE' ORDER BY tut_correlativo DESC LIMIT 1", [id]
  );
  const t = payload.tutora && (payload.tutora.apellidos || payload.tutora.dpi) ? payload.tutora : null;
  if (menor && !t && !tutVig.length) validarTutora(null, "El beneficiario");
  if (t) validarTutora(t, "El beneficiario");

  const usuario = currentUser?.usuario || "sistema";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE RPJ_MNT_BENEFICIARIO
          SET ben_tipo_parentesco = ?, ben_nombres = ?, ben_apellidos = ?, ben_dpi = ?, ben_fecha_nacimiento = ?,
              ben_telefono = ?, ben_correo = ?
        WHERE ben_correlativo = ?`,
      [parentesco, String(b.nombres || "").trim().toUpperCase(), String(b.apellidos).trim().toUpperCase(), dpi,
       fechaValida(b.fechaNacimiento), b.telefono || null, b.correo || null, id]
    );
    if (t) {
      const datos = [t.nombres ? String(t.nombres).trim().toUpperCase() : "", String(t.apellidos).trim().toUpperCase(),
        String(t.dpi).trim(), t.parentesco ? String(t.parentesco).toUpperCase() : null, t.telefono || null];
      if (tutVig.length) {
        await conn.execute(
          `UPDATE RPJ_MNT_TUTOR SET tut_nombres = ?, tut_apellidos = ?, tut_dpi = ?, tut_parentesco = ?, tut_telefono = ?
            WHERE tut_correlativo = ?`,
          [...datos, tutVig[0].tut_correlativo]
        );
      } else {
        await conn.execute(
          `INSERT INTO RPJ_MNT_TUTOR
             (tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi, tut_parentesco, tut_telefono, tut_fecha_inicio, tut_usuario_creacion)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?)`,
          [id, ...datos, fechaValida(t.fechaInicio), usuario]
        );
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.code === "ER_DUP_ENTRY") throw createError("Ya existe un beneficiario con ese DPI", 409);
    throw e;
  } finally {
    conn.release();
  }
  logger.info("Beneficiario actualizado", { id, usuario });
  return getByJubilado(actual.ben_id_jubilado);
};

// Reparte de nuevo los porcentajes de todos los beneficiarios de un jubilado.
// payload: { porcentajes: [{ id, porcentaje }] }. Deben venir todos y sumar 100.
const actualizarPorcentajes = async (idJubilado, payload, currentUser) => {
  const lista = Array.isArray(payload?.porcentajes) ? payload.porcentajes : [];
  const [rows] = await pool.execute(
    "SELECT ben_correlativo AS id, ben_estado AS estado FROM RPJ_MNT_BENEFICIARIO WHERE ben_id_jubilado = ?", [idJubilado]
  );
  if (!rows.length) throw createError("El jubilado no tiene beneficiarios", 404);
  const ids = new Set(rows.map((r) => Number(r.id)));
  if (lista.length !== ids.size || !lista.every((x) => ids.has(Number(x.id)))) {
    throw createError("Debe indicar el porcentaje de todos los beneficiarios del jubilado");
  }
  lista.forEach((x) => {
    const p = toNum(x.porcentaje);
    if (p <= 0 || p > 100) throw createError("Cada porcentaje debe estar entre 0.01 y 100");
  });
  const total = Math.round(lista.reduce((s, x) => s + toNum(x.porcentaje), 0) * 100) / 100;
  if (total !== 100) throw createError(`La suma de porcentajes debe ser 100.00 (actual: ${total.toFixed(2)})`);
  // Si ya hay beneficiarios cobrando, el reparto no se cambia desde aquí.
  const cobrando = rows.find((r) => ["ACTIVO", "SUSPENDIDO"].includes(String(r.estado).toUpperCase()));
  if (cobrando) throw createError("Los beneficiarios ya están cobrando: el reparto de porcentajes no se puede cambiar aquí", 409);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const x of lista) {
      await conn.execute("UPDATE RPJ_MNT_BENEFICIARIO SET ben_porcentaje = ? WHERE ben_correlativo = ? AND ben_id_jubilado = ?",
        [Math.round(toNum(x.porcentaje) * 100) / 100, x.id, idJubilado]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  logger.info("Porcentajes de beneficiarios actualizados", { idJubilado, usuario: currentUser?.usuario });
  return getByJubilado(idJubilado);
};

const registrarTutor = async (payload, currentUser) => {
  if (!payload?.idBeneficiario) throw createError("Debe indicar el beneficiario (idBeneficiario)");
  validarTutora(payload, "Tutora");
  const usuario = currentUser?.usuario || "sistema";
  const [res] = await pool.execute(
    `INSERT INTO RPJ_MNT_TUTOR
       (tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi, tut_parentesco, tut_telefono, tut_fecha_inicio, tut_usuario_creacion)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?)`,
    [payload.idBeneficiario, payload.nombres || "", payload.apellidos, String(payload.dpi).trim(),
     payload.parentesco || null, payload.telefono || null,
     /^\d{4}-\d{2}-\d{2}/.test(String(payload.fechaInicio || "")) ? String(payload.fechaInicio).slice(0, 10) : null, usuario]
  );
  return { id: res.insertId };
};

// ---------------------------------------------------------------------------
// Consultas por estado + suspensión / reactivación (empleo estatal).
// ---------------------------------------------------------------------------
const listarPorEstado = async (estado, q) => {
  const term = String(q || "").trim();
  const like = `%${term}%`;
  // Se busca por código del beneficiario, sus datos, y también por código o
  // nombre del jubilado titular (así se puede llegar por el expediente del jubilado).
  const filtroQ = term
    ? ` AND (b.ben_correlativo LIKE ? OR b.ben_nombres LIKE ? OR b.ben_apellidos LIKE ? OR b.ben_dpi LIKE ?
             OR j.jub_id LIKE ? OR CONCAT(j.jub_nombres, ' ', j.jub_apellidos) LIKE ?)`
    : "";
  const params = term ? [estado, like, like, like, like, like, like] : [estado];
  const [rows] = await pool.query(
    `SELECT b.ben_correlativo AS id, b.ben_id_jubilado AS idJubilado, b.ben_tipo_parentesco AS tipoParentesco,
            b.ben_nombres AS nombres, b.ben_apellidos AS apellidos, b.ben_dpi AS dpi,
            b.ben_fecha_nacimiento AS fechaNacimiento, b.ben_porcentaje AS porcentaje,
            b.ben_telefono AS telefono, b.ben_correo AS correo, b.ben_estado AS estado,
            b.ben_empleador_estatal AS empleadorEstatal, b.ben_fecha_inicio_empleo AS fechaInicioEmpleo,
            j.jub_id AS codigoJubilado,
            CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS jubiladoNombre
       FROM RPJ_MNT_BENEFICIARIO b
       INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = b.ben_id_jubilado
      WHERE b.ben_estado = ?${filtroQ}
      ORDER BY b.ben_apellidos, b.ben_nombres`,
    params
  );
  return rows.map((r) => ({ ...mapBeneficiario(r), jubiladoNombre: r.jubiladoNombre, codigoJubilado: r.codigoJubilado }));
};

const getActivos = (q) => listarPorEstado("ACTIVO", q);
const getSuspendidos = () => listarPorEstado("SUSPENDIDO");

const suspender = async (id, body, currentUser) => {
  const [rows] = await pool.execute("SELECT ben_estado FROM RPJ_MNT_BENEFICIARIO WHERE ben_correlativo = ?", [id]);
  if (!rows[0]) throw createError("Beneficiario no encontrado", 404);
  if (rows[0].ben_estado !== "ACTIVO") throw createError("Solo se puede suspender un beneficiario ACTIVO", 409);
  const motivo = String(body?.motivo || "").toUpperCase();
  if (motivo === "EMPLEO_ESTATAL" && (!body?.empleador || String(body.empleador).trim() === "")) {
    throw createError("El empleador estatal es obligatorio cuando el motivo es EMPLEO_ESTATAL");
  }
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Suspendiendo beneficiario", { id, motivo, usuario });
  await pool.execute(
    `UPDATE RPJ_MNT_BENEFICIARIO
        SET ben_estado = 'SUSPENDIDO', ben_empleador_estatal = ?, ben_fecha_inicio_empleo = ?
      WHERE ben_correlativo = ?`,
    [body?.empleador || null, body?.fechaInicioEmpleo || null, id]
  );
  return { id: Number(id), estado: "SUSPENDIDO" };
};

const reactivar = async (id, currentUser) => {
  const [rows] = await pool.execute("SELECT ben_estado FROM RPJ_MNT_BENEFICIARIO WHERE ben_correlativo = ?", [id]);
  if (!rows[0]) throw createError("Beneficiario no encontrado", 404);
  if (rows[0].ben_estado !== "SUSPENDIDO") throw createError("Solo se puede reactivar un beneficiario SUSPENDIDO", 409);
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Reactivando beneficiario", { id, usuario });
  await pool.execute(
    `UPDATE RPJ_MNT_BENEFICIARIO
        SET ben_estado = 'ACTIVO', ben_empleador_estatal = NULL, ben_fecha_inicio_empleo = NULL
      WHERE ben_correlativo = ?`,
    [id]
  );
  return { id: Number(id), estado: "ACTIVO" };
};

module.exports = {
  buscarJubilados, getByJubilado, registrarLote, remove, registrarTutor, actualizar, actualizarPorcentajes,
  getActivos, getSuspendidos, suspender, reactivar
};
