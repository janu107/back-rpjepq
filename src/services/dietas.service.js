const adminPagos = require("./adminPagos.service");
const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

// Pago de Dietas (modelo vdi_*). El CRUD básico del encabezado se delega en
// adminPagos; aquí se agregan las operaciones del flujo maestro-detalle:
// pagos del mes, recálculo, detalle de sesiones y cambios de estado del pago.

const sql = (file) => getSql(`dietas/${file}.sql`);
const num = (v) => Number(v || 0);

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const PERIODO_RE = /^\d{4}-\d{2}$/;
const TIPOS_DOCUMENTO = ["CHEQUE", "TRANSFERENCIA", "DEPOSITO"];

const assertPeriodo = (periodo) => {
  if (!PERIODO_RE.test(String(periodo || ""))) throw createError("Periodo inválido (use YYYY-MM)");
};

const mapPago = (r) => ({
  id: r.vdi_correlativo,
  idJuntaDirectiva: r.vdi_id_junta_directiva,
  periodo: r.vdi_periodo,
  totalSesiones: num(r.vdi_total_sesiones),
  valor: num(r.vdi_valor),
  isr: num(r.vdi_isr),
  valorPago: num(r.vdi_valor_pago),
  estado: r.vdi_estado,
  noDocumento: r.vdi_no_documento,
  tipoDocumento: r.vdi_tipo_documento,
  banco: r.vdi_banco,
  fechaPago: r.vdi_fecha_pago,
  fechaRecibido: r.vdi_fecha_recibido,
  observaciones: r.vdi_observaciones,
  juntaNombre: `${r.jun_nombre || ""} ${r.jun_apellidos || ""}`.trim(),
  juntaPuesto: r.jun_puesto
});

const pagosDelMes = async (periodo) => {
  assertPeriodo(periodo);
  const [rows] = await pool.execute(sql("pagosDelMes"), [periodo]);
  return rows.map(mapPago);
};

const recalcular = async (periodo) => {
  assertPeriodo(periodo);
  await pool.execute(sql("recalcularMes"), [periodo]);
  logger.info("Dietas recalculadas", { periodo });
  return pagosDelMes(periodo);
};

const detalle = async (id) => {
  const pago = await adminPagos.getById("dietas", id);
  const [rows] = await pool.execute(sql("detalleSesiones"), [id]);
  return {
    pago,
    sesiones: rows.map((r) => ({
      idDetalle: r.die_correlativo,
      valor: num(r.die_valor),
      idSesion: r.ses_correlativo,
      acta: r.ses_acta,
      fechaSesion: r.ses_fecha_sesion ? String(r.ses_fecha_sesion).slice(0, 10) : null,
      descripcion: r.ses_descripcion,
      estado: r.ses_estado
    }))
  };
};

const marcarPagado = async (id, payload, currentUser) => {
  const pago = await adminPagos.getById("dietas", id);
  if (pago.estado !== "PENDIENTE") throw createError("Solo se puede emitir el pago cuando está PENDIENTE", 409);
  const tipoDoc = String(payload?.tipoDocumento || "").toUpperCase();
  if (!payload?.noDocumento || !tipoDoc || !payload?.banco || !payload?.fechaPago) {
    throw createError("Para emitir el pago se requiere No. documento, tipo documento, banco y fecha de pago");
  }
  if (!TIPOS_DOCUMENTO.includes(tipoDoc)) throw createError("Tipo de documento no válido");
  const [res] = await pool.execute(sql("marcarPagado"), [payload.noDocumento, tipoDoc, payload.banco, payload.fechaPago, id]);
  if (res.affectedRows === 0) throw createError("El pago cambió de estado, recargue e intente de nuevo", 409);
  logger.info("Dieta emitida (PAGADO)", { id, usuario: currentUser?.usuario });
  return adminPagos.getById("dietas", id);
};

const marcarRecibido = async (id, payload, currentUser) => {
  const pago = await adminPagos.getById("dietas", id);
  if (pago.estado !== "PAGADO") throw createError("Solo se puede marcar recibido un pago en estado PAGADO", 409);
  if (!payload?.fechaRecibido) throw createError("Se requiere la fecha de recibido");
  const [res] = await pool.execute(sql("marcarRecibido"), [payload.fechaRecibido, id]);
  if (res.affectedRows === 0) throw createError("El pago cambió de estado, recargue e intente de nuevo", 409);
  logger.info("Dieta marcada RECIBIDO", { id, usuario: currentUser?.usuario });
  return adminPagos.getById("dietas", id);
};

module.exports = {
  list: () => adminPagos.list("dietas"),
  getById: (id) => adminPagos.getById("dietas", id),
  create: (payload, user) => adminPagos.create("dietas", payload, user),
  update: (id, payload, user) => adminPagos.update("dietas", id, payload, user),
  remove: (id, user) => adminPagos.remove("dietas", id, user),
  pagosDelMes,
  recalcular,
  detalle,
  marcarPagado,
  marcarRecibido
};
