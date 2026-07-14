const logger = require("../config/logger");
const { pool } = require("../config/db");
const { createError } = require("../utils/planillaEstado");

// ============================================================================
// Amparistas: registro de juicio (SP), listado de vigentes y revocación.
// ============================================================================

const toNum = (v) => Number(v || 0);

const callSp = async (spCall, inParams, outNames) => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CALL ${spCall}`, inParams);
    if (!outNames || !outNames.length) return {};
    const outSelect = outNames.map((n) => `@${n} AS ${n}`).join(", ");
    const [[outRow]] = await conn.query(`SELECT ${outSelect}`);
    return outRow;
  } finally {
    conn.release();
  }
};

const registrar = async (payload, currentUser) => {
  const req = ["idJubilado", "noExpediente", "juzgado", "fechaSentencia", "fechaEfectiva"];
  for (const f of req) {
    if (!payload?.[f] || String(payload[f]).trim() === "") throw createError(`El campo ${f} es obligatorio`);
  }
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Registrando amparista", { idJubilado: payload.idJubilado, expediente: payload.noExpediente, usuario });
  const out = await callSp(
    "sp_registrar_amparista(?, ?, ?, ?, ?, ?, ?, ?, @p_res)",
    [payload.idJubilado, payload.noExpediente, payload.juzgado, payload.fechaSentencia,
     payload.fechaEfectiva, payload.abogado || null, payload.observaciones || null, usuario],
    ["p_res"]
  );
  return { message: out.p_res };
};

const vigentes = async () => {
  const [rows] = await pool.execute(
    `SELECT j.jui_correlativo AS id, j.jui_id_jubilado AS idJubilado,
            CONCAT(ju.jub_nombres, ' ', ju.jub_apellidos) AS jubiladoNombre, ju.jub_dpi AS dpi,
            j.jui_no_expediente AS noExpediente, j.jui_juzgado AS juzgado,
            j.jui_fecha_sentencia AS fechaSentencia, j.jui_fecha_efectiva AS fechaEfectiva,
            j.jui_abogado_asociacion AS abogado, j.jui_estado AS estado
       FROM RPJ_MNT_JUICIO j
       INNER JOIN RPJ_MNT_JUBILADO ju ON ju.jub_correlativo = j.jui_id_jubilado
      WHERE j.jui_estado = 'VIGENTE'
      ORDER BY j.jui_fecha_efectiva DESC`
  );
  return rows;
};

const revocar = async (idJuicio, motivo, currentUser) => {
  const [rows] = await pool.execute(
    "SELECT jui_id_jubilado, jui_estado FROM RPJ_MNT_JUICIO WHERE jui_correlativo = ?", [idJuicio]
  );
  if (!rows[0]) throw createError("Juicio no encontrado", 404);
  if (rows[0].jui_estado !== "VIGENTE") throw createError("El juicio no está VIGENTE", 409);
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo de revocación es obligatorio");
  const idJubilado = rows[0].jui_id_jubilado;
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Revocando amparista", { idJuicio, idJubilado, usuario });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE RPJ_MNT_JUICIO SET jui_estado = 'REVOCADO', jui_fecha_revocacion = CURDATE(), jui_motivo_revocacion = ? WHERE jui_correlativo = ?",
      [motivo, idJuicio]
    );
    await conn.execute("UPDATE RPJ_MNT_JUBILADO SET jub_tipo_pago = 'NORMAL' WHERE jub_correlativo = ?", [idJubilado]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  // NOTA: la deuda ya generada al 100% no se recalcula automáticamente al 50%
  // (requeriría regla explícita). Queda como está; ajustar manualmente si aplica.
  return { idJuicio: Number(idJuicio), idJubilado, estado: "REVOCADO" };
};

const verificarExpediente = async (exp) => {
  const [rows] = await pool.execute("SELECT COUNT(*) AS c FROM RPJ_MNT_JUICIO WHERE jui_no_expediente = ?", [exp || ""]);
  return { existe: Number(rows[0].c) > 0 };
};

module.exports = { registrar, vigentes, revocar, verificarExpediente };
