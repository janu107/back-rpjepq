const logger = require("../config/logger");
const { pool } = require("../config/db");
const { createError } = require("../utils/planillaEstado");

// ============================================================================
// Generación / reversión de nóminas del módulo de jubilados.
//   - Jubilados NORMAL (tipo 2): sp_generar_nomina_pensionados + sp_generar_nomina_beneficiarios
//   - Amparistas (tipo 4)      : sp_generar_nomina_amparistas
//   - Reverso                  : sp_reversar_planilla_pensionados (opera por planilla, tipo_manejo=2)
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

const getPlanilla = async (id) => {
  const [rows] = await pool.execute(
    "SELECT ppl_correlativo, ppl_tipo_planilla, ppl_estado_proceso FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = ?",
    [id]
  );
  if (!rows[0]) throw createError("Planilla no encontrada", 404);
  return rows[0];
};

const generarJubilados = async (idPlanilla, tipoIngreso, currentUser) => {
  const p = await getPlanilla(idPlanilla);
  if (Number(p.ppl_tipo_planilla) !== 2) throw createError("La planilla no es de tipo 2 (Jubilados/Pensionados)", 409);
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Generando nomina jubilados (normal + beneficiarios)", { idPlanilla, usuario });

  const outN = await callSp(
    "sp_generar_nomina_pensionados(?, ?, ?, @p_proc, @p_excl, @p_pag, @p_desc)",
    [idPlanilla, tipoIngreso || 0, usuario], ["p_proc", "p_excl", "p_pag", "p_desc"]
  );
  const outB = await callSp(
    "sp_generar_nomina_beneficiarios(?, ?, @b_proc, @b_tot, @b_res)",
    [idPlanilla, usuario], ["b_proc", "b_tot", "b_res"]
  );
  return {
    jubilados: { procesados: toNum(outN.p_proc), excluidos: toNum(outN.p_excl), totalPagado: toNum(outN.p_pag), totalDescuentos: toNum(outN.p_desc) },
    beneficiarios: { procesados: toNum(outB.b_proc), total: toNum(outB.b_tot), message: outB.b_res },
    estadoNuevo: "GENERADA"
  };
};

const generarAmparistas = async (idPlanilla, currentUser) => {
  const p = await getPlanilla(idPlanilla);
  if (Number(p.ppl_tipo_planilla) !== 4) throw createError("La planilla no es de tipo 4 (Amparistas)", 409);
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Generando nomina amparistas", { idPlanilla, usuario });
  const out = await callSp(
    "sp_generar_nomina_amparistas(?, ?, @a_proc, @a_tot, @a_res)",
    [idPlanilla, usuario], ["a_proc", "a_tot", "a_res"]
  );
  return { procesados: toNum(out.a_proc), total: toNum(out.a_tot), message: out.a_res, estadoNuevo: "GENERADA" };
};

const revertir = async (idPlanilla, motivo, currentUser) => {
  await getPlanilla(idPlanilla);
  if (!motivo || String(motivo).trim() === "") throw createError("El motivo de reverso es obligatorio");
  const usuario = currentUser?.usuario || "sistema";
  logger.info("Revirtiendo nomina jubilados", { idPlanilla, usuario });
  await callSp("sp_reversar_planilla_pensionados(?, ?, ?)", [idPlanilla, usuario, motivo], []);
  return { idPlanilla: Number(idPlanilla), estadoNuevo: "REVERSADA" };
};

module.exports = { generarJubilados, generarAmparistas, revertir };
