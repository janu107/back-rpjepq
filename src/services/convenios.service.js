const logger = require("../config/logger");
const dayjs = require("dayjs");
const { pool } = require("../config/db");
const { createError } = require("../utils/planillaEstado");

// ============================================================================
// Convenios de pago de deuda (de un jubilado O de un beneficiario).
// ============================================================================

const TIPOS = ["MENSUAL", "QUINCENAL", "UNICO", "CUOTAS_GRANDES"];
const AUTORIZA = ["JUEZ", "JUNTA_DIRECTIVA", "ACUERDO_INTERNO"];
const toNum = (v) => Number(v || 0);

// Candidatos: jubilados y beneficiarios con saldo de deuda pendiente.
const candidatos = async (q) => {
  const term = String(q || "").trim();
  const like = `%${term}%`;
  const fj = term ? " AND (j.jub_nombres LIKE ? OR j.jub_apellidos LIKE ? OR j.jub_dpi LIKE ?)" : "";
  const fb = term ? " AND (b.ben_nombres LIKE ? OR b.ben_apellidos LIKE ? OR b.ben_dpi LIKE ?)" : "";
  const pj = term ? [like, like, like] : [];
  const [jubs] = await pool.query(
    `SELECT 'jubilado' AS tipo, j.jub_correlativo AS id, CONCAT(j.jub_nombres,' ',j.jub_apellidos) AS nombre,
            j.jub_dpi AS dpi, SUM(d.deu_saldo) AS saldo
       FROM RPJ_MNT_JUBILADO j
       INNER JOIN RPJ_MNT_DEUDA d ON d.deu_id_jubilado = j.jub_correlativo AND d.deu_id_beneficiario IS NULL
      WHERE d.deu_es_deuda = 1 AND d.deu_estado IN ('PENDIENTE','PARCIAL')${fj}
      GROUP BY j.jub_correlativo HAVING saldo > 0 ORDER BY nombre LIMIT 20`, pj
  );
  const [bens] = await pool.query(
    `SELECT 'beneficiario' AS tipo, b.ben_correlativo AS id, CONCAT(b.ben_nombres,' ',b.ben_apellidos) AS nombre,
            b.ben_dpi AS dpi, SUM(d.deu_saldo) AS saldo
       FROM RPJ_MNT_BENEFICIARIO b
       INNER JOIN RPJ_MNT_DEUDA d ON d.deu_id_beneficiario = b.ben_correlativo
      WHERE d.deu_es_deuda = 1 AND d.deu_estado IN ('PENDIENTE','PARCIAL')${fb}
      GROUP BY b.ben_correlativo HAVING saldo > 0 ORDER BY nombre LIMIT 20`, pj
  );
  return [...jubs, ...bens].map((r) => ({ tipo: r.tipo, id: r.id, nombre: r.nombre, dpi: r.dpi, saldo: toNum(r.saldo) }));
};

const deudaPorPersona = async (tipo, id) => {
  const t = String(tipo || "").toLowerCase();
  if (!["jubilado", "beneficiario"].includes(t)) throw createError("Tipo debe ser 'jubilado' o 'beneficiario'");
  const col = t === "jubilado" ? "deu_id_jubilado" : "deu_id_beneficiario";
  const extra = t === "jubilado" ? "AND deu_id_beneficiario IS NULL" : "";
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(deu_saldo),0) AS saldo, COUNT(*) AS periodos
       FROM RPJ_MNT_DEUDA
      WHERE ${col} = ? ${extra} AND deu_es_deuda = 1 AND deu_estado IN ('PENDIENTE','PARCIAL')`,
    [id]
  );
  return { tipo: t, id: Number(id), saldo: toNum(row.saldo), periodosPendientes: toNum(row.periodos) };
};

const calcularFechaFin = (tipo, fechaInicio, cuotas) => {
  const ini = dayjs(fechaInicio);
  if (!ini.isValid()) return null;
  if (tipo === "UNICO") return ini.format("YYYY-MM-DD");
  if (tipo === "QUINCENAL") return ini.add(cuotas * 15, "day").format("YYYY-MM-DD");
  return ini.add(cuotas, "month").format("YYYY-MM-DD"); // MENSUAL / CUOTAS_GRANDES
};

const crear = async (payload, currentUser) => {
  if (!TIPOS.includes(String(payload?.tipo || "").toUpperCase())) throw createError("Tipo de convenio no válido");
  const tipo = String(payload.tipo).toUpperCase();
  let conIdJubilado = payload.idJubilado || null;
  const conIdBeneficiario = payload.idBeneficiario || null;
  if (!conIdJubilado && !conIdBeneficiario) throw createError("Debe indicar un jubilado o un beneficiario");
  // con_id_jubilado es NOT NULL en la BD: si es convenio de beneficiario, tomamos su jubilado padre.
  if (!conIdJubilado && conIdBeneficiario) {
    const [[b]] = await pool.execute("SELECT ben_id_jubilado FROM RPJ_MNT_BENEFICIARIO WHERE ben_correlativo = ?", [conIdBeneficiario]);
    if (!b) throw createError("Beneficiario no encontrado", 404);
    conIdJubilado = b.ben_id_jubilado;
  }
  if (!payload.noDocumento || String(payload.noDocumento).trim() === "") throw createError("El número de documento es obligatorio");
  if (!payload.autorizadoPor || !AUTORIZA.includes(String(payload.autorizadoPor).toUpperCase())) throw createError("Autorizado por es obligatorio y debe ser válido");

  const deudaTotal = toNum(payload.deudaTotal);
  if (deudaTotal <= 0) throw createError("La deuda total debe ser mayor a 0");
  let cuotas = parseInt(payload.cantidadCuotas, 10);
  if (tipo === "UNICO") cuotas = 1;
  if (!Number.isInteger(cuotas) || cuotas < 1) throw createError("La cantidad de cuotas debe ser un entero >= 1");

  const montoCuota = Math.round((deudaTotal / cuotas) * 100) / 100;
  const fechaInicio = payload.fechaInicio || dayjs().format("YYYY-MM-DD");
  const fechaFin = calcularFechaFin(tipo, fechaInicio, cuotas);
  const usuario = currentUser?.usuario || "sistema";

  logger.info("Creando convenio de pago", { tipo, conIdJubilado, conIdBeneficiario, cuotas, usuario });
  const [res] = await pool.execute(
    `INSERT INTO RPJ_MNT_CONVENIO_PAGO
       (con_id_jubilado, con_id_beneficiario, con_tipo_convenio, con_monto_total, con_cantidad_cuotas, con_monto_cuota,
        con_fecha_inicio, con_fecha_fin_estimada, con_autorizado_por, con_no_documento, con_estado, con_usuario_creacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VIGENTE', ?)`,
    [conIdJubilado, conIdBeneficiario, tipo, deudaTotal, cuotas, montoCuota, fechaInicio, fechaFin,
     String(payload.autorizadoPor).toUpperCase(), payload.noDocumento, usuario]
  );
  return { id: res.insertId, tipo, cantidadCuotas: cuotas, montoCuota, fechaInicio, fechaFin };
};

const vigentes = async () => {
  const [rows] = await pool.execute(
    `SELECT c.con_correlativo AS id, c.con_tipo_convenio AS tipo, c.con_monto_total AS deudaTotal,
            c.con_cantidad_cuotas AS cantidadCuotas, c.con_monto_cuota AS montoCuota,
            c.con_fecha_inicio AS fechaInicio, c.con_fecha_fin_estimada AS fechaFin, c.con_autorizado_por AS autorizadoPor,
            c.con_no_documento AS noDocumento, c.con_estado AS estado,
            COALESCE(CONCAT(j.jub_nombres,' ',j.jub_apellidos), CONCAT(b.ben_nombres,' ',b.ben_apellidos)) AS titular,
            IF(c.con_id_jubilado IS NOT NULL, 'JUBILADO', 'BENEFICIARIO') AS tipoTitular
       FROM RPJ_MNT_CONVENIO_PAGO c
       LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = c.con_id_jubilado
       LEFT JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_correlativo = c.con_id_beneficiario
      WHERE c.con_estado = 'VIGENTE' ORDER BY c.con_fecha_inicio DESC`
  );
  return rows.map((r) => ({ ...r, deudaTotal: toNum(r.deudaTotal), montoCuota: toNum(r.montoCuota), cantidadCuotas: toNum(r.cantidadCuotas) }));
};

const cancelar = async (id, currentUser) => {
  const [rows] = await pool.execute("SELECT con_estado FROM RPJ_MNT_CONVENIO_PAGO WHERE con_correlativo = ?", [id]);
  if (!rows[0]) throw createError("Convenio no encontrado", 404);
  if (rows[0].con_estado !== "VIGENTE") throw createError("Solo se puede cancelar un convenio VIGENTE", 409);
  logger.info("Cancelando convenio", { id, usuario: currentUser?.usuario });
  await pool.execute("UPDATE RPJ_MNT_CONVENIO_PAGO SET con_estado = 'CANCELADO' WHERE con_correlativo = ?", [id]);
  return { id: Number(id), estado: "CANCELADO" };
};

module.exports = { candidatos, deudaPorPersona, crear, vigentes, cancelar };
