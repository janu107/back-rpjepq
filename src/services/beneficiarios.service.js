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

// Datos de pago (cuenta donde se deposita). Con ABONO CUENTA se exigen banco,
// tipo y número de cuenta; con CHEQUE no. Sin forma de pago queda pendiente.
const FORMAS_PAGO = ["ABONO CUENTA", "CHEQUE"];
const TIPOS_CUENTA = ["AHORRO", "MONETARIA"];
const datosPago = (o, etiqueta) => {
  const forma = String(o?.formaPago || "").trim().toUpperCase() || null;
  if (forma && !FORMAS_PAGO.includes(forma)) throw createError(`${etiqueta}: forma de pago no válida (ABONO CUENTA o CHEQUE)`);
  const idBanco = o?.idBanco ? Number(o.idBanco) : null;
  const tipo = String(o?.tipoCuenta || "").trim().toUpperCase() || null;
  const cuenta = String(o?.cuenta || "").replace(/\s/g, "").toUpperCase() || null;
  if (forma === "ABONO CUENTA") {
    if (!idBanco) throw createError(`${etiqueta}: seleccione el banco`);
    if (!tipo || !TIPOS_CUENTA.includes(tipo)) throw createError(`${etiqueta}: seleccione el tipo de cuenta (AHORRO o MONETARIA)`);
    if (!cuenta) throw createError(`${etiqueta}: ingrese el número de cuenta`);
  }
  return forma === "CHEQUE" ? [forma, idBanco, null, null] : [forma, idBanco, tipo, cuenta];
};

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
  formaPago: b.formaPago || null,
  idBanco: b.idBanco || null,
  bancoNombre: b.bancoNombre || null,
  tipoCuenta: b.tipoCuenta || null,
  cuenta: b.cuenta || null,
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
            ben_empleador_estatal AS empleadorEstatal, ben_fecha_inicio_empleo AS fechaInicioEmpleo,
            ben_forma_pago AS formaPago, ben_id_banco AS idBanco, bb.ban_descripcion AS bancoNombre,
            ben_tipo_cuenta AS tipoCuenta, ben_cuenta AS cuenta
       FROM RPJ_MNT_BENEFICIARIO
       LEFT JOIN RPJ_CAT_BANCOS bb ON bb.ban_id = ben_id_banco
      WHERE ben_id_jubilado = ? ORDER BY ben_correlativo`,
    [idJubilado]
  );
  const beneficiarios = rows.map(mapBeneficiario);
  if (beneficiarios.length) {
    const ids = beneficiarios.map((b) => b.id);
    const [tutores] = await pool.query(
      `SELECT tut_correlativo AS id, tut_id_beneficiario AS idBeneficiario, tut_nombres AS nombres,
              tut_apellidos AS apellidos, tut_dpi AS dpi, tut_parentesco AS parentesco, tut_telefono AS telefono,
              tut_fecha_inicio AS fechaInicio, tut_estado AS estado,
              tut_forma_pago AS formaPago, tut_id_banco AS idBanco, tb.ban_descripcion AS bancoNombre,
              tut_tipo_cuenta AS tipoCuenta, tut_cuenta AS cuenta
         FROM RPJ_MNT_TUTOR LEFT JOIN RPJ_CAT_BANCOS tb ON tb.ban_id = tut_id_banco
        WHERE tut_id_beneficiario IN (?) ORDER BY tut_correlativo`,
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
            ben_fecha_nacimiento, ben_porcentaje, ben_telefono, ben_correo, ben_estado, ben_fecha_registro, ben_usuario_creacion,
            ben_forma_pago, ben_id_banco, ben_tipo_cuenta, ben_cuenta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REGISTRADO', CURDATE(), ?, ?, ?, ?, ?)`,
        [idJubilado, String(b.tipoParentesco).toUpperCase(), b.nombres || "", b.apellidos, String(b.dpi).trim(),
         b.fechaNacimiento, toNum(b.porcentaje), b.telefono || null, b.correo || null, usuario,
         ...datosPago(b, `Beneficiario ${b.apellidos}`)]
      );
      const idBen = res.insertId;
      if (b.tutora) {
        const t = b.tutora;
        await conn.execute(
          // La tutoría empieza al registrarla (o en la fecha indicada).
          `INSERT INTO RPJ_MNT_TUTOR
             (tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi, tut_parentesco, tut_telefono, tut_fecha_inicio, tut_usuario_creacion,
              tut_forma_pago, tut_id_banco, tut_tipo_cuenta, tut_cuenta)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?, ?, ?, ?, ?)`,
          [idBen, t.nombres || "", t.apellidos, String(t.dpi).trim(), t.parentesco || null, t.telefono || null,
           /^\d{4}-\d{2}-\d{2}/.test(String(t.fechaInicio || "")) ? String(t.fechaInicio).slice(0, 10) : null, usuario,
           ...datosPago(t, `Tutora de ${b.apellidos}`)]
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

  const pagoBen = datosPago(payload, "El beneficiario");
  const pagoTut = t ? datosPago(t, "La tutora") : null;
  const usuario = currentUser?.usuario || "sistema";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE RPJ_MNT_BENEFICIARIO
          SET ben_tipo_parentesco = ?, ben_nombres = ?, ben_apellidos = ?, ben_dpi = ?, ben_fecha_nacimiento = ?,
              ben_telefono = ?, ben_correo = ?, ben_forma_pago = ?, ben_id_banco = ?, ben_tipo_cuenta = ?, ben_cuenta = ?
        WHERE ben_correlativo = ?`,
      [parentesco, String(b.nombres || "").trim().toUpperCase(), String(b.apellidos).trim().toUpperCase(), dpi,
       fechaValida(b.fechaNacimiento), b.telefono || null, b.correo || null, ...pagoBen, id]
    );
    if (t) {
      const datos = [t.nombres ? String(t.nombres).trim().toUpperCase() : "", String(t.apellidos).trim().toUpperCase(),
        String(t.dpi).trim(), t.parentesco ? String(t.parentesco).toUpperCase() : null, t.telefono || null];
      if (tutVig.length) {
        await conn.execute(
          `UPDATE RPJ_MNT_TUTOR SET tut_nombres = ?, tut_apellidos = ?, tut_dpi = ?, tut_parentesco = ?, tut_telefono = ?,
                  tut_forma_pago = ?, tut_id_banco = ?, tut_tipo_cuenta = ?, tut_cuenta = ?
            WHERE tut_correlativo = ?`,
          [...datos, ...pagoTut, tutVig[0].tut_correlativo]
        );
      } else {
        await conn.execute(
          `INSERT INTO RPJ_MNT_TUTOR
             (tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi, tut_parentesco, tut_telefono, tut_fecha_inicio, tut_usuario_creacion,
              tut_forma_pago, tut_id_banco, tut_tipo_cuenta, tut_cuenta)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?, ?, ?, ?, ?)`,
          [id, ...datos, fechaValida(t.fechaInicio), usuario, ...pagoTut]
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

// ---------------------------------------------------------------------------
// Estado de cuenta de un beneficiario (viuda o huérfano de un jubilado fallecido).
//   - Esposa mientras cobra la deuda del fallecido: avance de esa deuda.
//   - Viudez / orfandad: lo que se le debe cada mes, lo pagado y lo pendiente.
//   - Pagos recibidos por planilla (sin las REVERSADAS).
// ---------------------------------------------------------------------------
const estadoCuenta = async (id) => {
  const [[b]] = await pool.query(
    `SELECT b.ben_correlativo AS id, b.ben_tipo_parentesco AS parentesco, b.ben_nombres AS nombres, b.ben_apellidos AS apellidos,
            b.ben_dpi AS dpi, b.ben_fecha_nacimiento AS fechaNacimiento, b.ben_porcentaje AS porcentaje, b.ben_estado AS estado,
            b.ben_fecha_activacion AS fechaActivacion, b.ben_fecha_desactivacion AS fechaDesactivacion,
            b.ben_forma_pago AS formaPago, bb.ban_descripcion AS banco, b.ben_cuenta AS cuenta,
            j.jub_correlativo AS idJubilado, j.jub_id AS codigoJubilado, CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS fallecido,
            j.jub_estado_pago AS estadoJubilado, j.jub_fecha_fallecimiento AS fechaFallecimiento,
            (SELECT MAX(s.sal_salario) FROM RPJ_MNT_SALARIO s WHERE s.sal_id_jubilado = j.jub_correlativo
                AND s.sal_tipo_manejo = 2 AND s.sal_tipo_ingreso = 1) AS pension
       FROM RPJ_MNT_BENEFICIARIO b
       JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = b.ben_id_jubilado
       LEFT JOIN RPJ_CAT_BANCOS bb ON bb.ban_id = b.ben_id_banco
      WHERE b.ben_correlativo = ?`, [id]
  );
  if (!b) throw createError("Beneficiario no encontrado", 404);

  const [[tut]] = await pool.query(
    `SELECT TRIM(CONCAT(COALESCE(t.tut_nombres, ''), ' ', t.tut_apellidos)) AS nombre, t.tut_dpi AS dpi,
            t.tut_forma_pago AS formaPago, tb.ban_descripcion AS banco, t.tut_cuenta AS cuenta
       FROM RPJ_MNT_TUTOR t LEFT JOIN RPJ_CAT_BANCOS tb ON tb.ban_id = t.tut_id_banco
      WHERE t.tut_id_beneficiario = ? AND t.tut_estado = 'VIGENTE' ORDER BY t.tut_correlativo DESC LIMIT 1`, [id]
  );
  const [[pla]] = await pool.query(
    "SELECT ppl_porcentaje_pago AS pct FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_tipo_planilla = 2 ORDER BY ppl_numero DESC LIMIT 1"
  );
  const pctPlanilla = toNum(pla?.pct || 50);
  const edadHoy = b.fechaNacimiento ? edad(b.fechaNacimiento) : null;
  const esMenor = b.parentesco !== "ESPOSA" && edadHoy !== null && edadHoy < 18;

  // Deuda del fallecido (la cobra la esposa).
  let deudaFallecido = null;
  if (b.parentesco === "ESPOSA") {
    const [[d]] = await pool.query(
      `SELECT COALESCE(SUM(deu_monto_original), 0) AS original, COALESCE(SUM(deu_monto_pagado), 0) AS pagado,
              COALESCE(SUM(deu_monto_pendiente), 0) AS pendiente, SUM(deu_monto_pendiente > 0) AS mesesPendientes,
              MIN(CASE WHEN deu_monto_pendiente > 0 THEN deu_periodo END) AS proximoMes,
              (SELECT deu_monto_original FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ? ORDER BY deu_periodo DESC LIMIT 1) AS ultimoLiquido
         FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = ?`, [b.idJubilado, b.idJubilado]
    );
    const [[c]] = await pool.query(
      `SELECT COALESCE(SUM(a.apa_monto_aplicado), 0) AS cobrado
         FROM RPJ_PRC_APLICACION_PAGO a JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = a.apa_id_planilla
        WHERE a.apa_id_jubilado = ? AND a.apa_observaciones LIKE ? AND p.ppl_estado_proceso = 'CERRADA'`,
      [b.idJubilado, `Beneficiario ${id}:%`]
    );
    const cuota = Math.round(toNum(d.ultimoLiquido) * pctPlanilla) / 100;
    deudaFallecido = {
      total: toNum(d.original), pagado: toNum(d.pagado), pendiente: toNum(d.pendiente),
      cobradoPorBeneficiaria: toNum(c.cobrado), mesesPendientes: toNum(d.mesesPendientes), proximoMes: d.proximoMes,
      cuotaMensual: cuota, mesesParaTerminar: cuota > 0 ? Math.ceil(toNum(d.pendiente) / cuota) : null
    };
  }

  const [meses] = await pool.query(
    `SELECT d.dbe_periodo AS periodo, d.dbe_concepto AS concepto, d.dbe_monto_original AS debe, d.dbe_monto_pagado AS pagado,
            d.dbe_monto_pendiente AS pendiente, d.dbe_estado AS estado,
            (SELECT GROUP_CONCAT(DISTINCT p.ppl_numero ORDER BY p.ppl_numero SEPARATOR ', ')
               FROM RPJ_PRC_APLICACION_PAGO_BEN a JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = a.apb_id_planilla
              WHERE a.apb_id_deuda = d.dbe_correlativo) AS pagadoCon
       FROM RPJ_PRC_DEUDA_BENEFICIARIO d WHERE d.dbe_id_beneficiario = ? ORDER BY d.dbe_periodo`, [id]
  );
  const [pagos] = await pool.query(
    `SELECT p.ppl_numero AS planilla, p.ppl_estado_proceso AS estadoPlanilla, p.ppl_fecha_pago AS fechaPago,
            i.nin_puesto AS concepto, i.nin_valor AS monto
       FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
      WHERE i.nin_id_beneficiario = ? AND p.ppl_estado_proceso <> 'REVERSADA'
      ORDER BY p.ppl_numero`, [id]
  );

  const sum = (arr, k) => Math.round(arr.reduce((a, x) => a + toNum(x[k]), 0) * 100) / 100;
  const pagosCerrados = pagos.filter((x) => x.estadoPlanilla === "CERRADA");
  const pension = toNum(b.pension);
  const montoMes = Math.round(pension * toNum(b.porcentaje)) / 100;
  let fase;
  if (b.estado === "INACTIVO") fase = "TERMINADO";
  else if (b.estado === "REGISTRADO") fase = "AÚN NO COBRA (el jubilado no está registrado como fallecido)";
  else if (b.parentesco === "ESPOSA") fase = deudaFallecido && deudaFallecido.pendiente > 0 ? "COBRANDO LA DEUDA DEL FALLECIDO" : "VIUDEZ";
  else if (b.parentesco === "HIJO" && !esMenor) fase = "MAYOR DE EDAD: SE LE LIQUIDA LO QUE SE LE DEBE";
  else fase = "ORFANDAD";

  return {
    beneficiario: {
      id: b.id, nombre: `${b.nombres || ""} ${b.apellidos}`.trim(), parentesco: b.parentesco, dpi: b.dpi,
      fechaNacimiento: b.fechaNacimiento, edad: edadHoy, esMenor, porcentaje: toNum(b.porcentaje), estado: b.estado,
      fechaActivacion: b.fechaActivacion, fechaDesactivacion: b.fechaDesactivacion,
      pago: esMenor && tut ? { aNombreDe: tut.nombre, formaPago: tut.formaPago, banco: tut.banco, cuenta: tut.cuenta, esTutora: true }
        : { aNombreDe: `${b.nombres || ""} ${b.apellidos}`.trim(), formaPago: b.formaPago, banco: b.banco, cuenta: b.cuenta, esTutora: false }
    },
    tutora: tut ? { nombre: tut.nombre, dpi: tut.dpi } : null,
    fallecido: { id: b.idJubilado, codigo: b.codigoJubilado, nombre: b.fallecido, fechaFallecimiento: b.fechaFallecimiento, pension },
    fase,
    mensual: { seLeDebe: montoMes, seLePaga: Math.round(montoMes * pctPlanilla) / 100, porcentajePlanilla: pctPlanilla },
    deudaFallecido,
    resumen: {
      debe: sum(meses, "debe"), pagado: sum(meses, "pagado"), pendiente: sum(meses, "pendiente"),
      recibido: sum(pagosCerrados, "monto"), planillasCobradas: pagosCerrados.length
    },
    meses: meses.map((m) => ({ ...m, debe: toNum(m.debe), pagado: toNum(m.pagado), pendiente: toNum(m.pendiente) })),
    pagos: pagos.map((x) => ({ ...x, monto: toNum(x.monto) }))
  };
};

const registrarTutor = async (payload, currentUser) => {
  if (!payload?.idBeneficiario) throw createError("Debe indicar el beneficiario (idBeneficiario)");
  validarTutora(payload, "Tutora");
  const usuario = currentUser?.usuario || "sistema";
  const [res] = await pool.execute(
    `INSERT INTO RPJ_MNT_TUTOR
       (tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi, tut_parentesco, tut_telefono, tut_fecha_inicio, tut_usuario_creacion,
        tut_forma_pago, tut_id_banco, tut_tipo_cuenta, tut_cuenta)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?, ?, ?, ?, ?)`,
    [payload.idBeneficiario, payload.nombres || "", payload.apellidos, String(payload.dpi).trim(),
     payload.parentesco || null, payload.telefono || null,
     /^\d{4}-\d{2}-\d{2}/.test(String(payload.fechaInicio || "")) ? String(payload.fechaInicio).slice(0, 10) : null, usuario,
     ...datosPago(payload, "Tutora")]
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
  buscarJubilados, getByJubilado, registrarLote, remove, registrarTutor, estadoCuenta, actualizar, actualizarPorcentajes,
  getActivos, getSuspendidos, suspender, reactivar
};
