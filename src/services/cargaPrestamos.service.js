const ExcelJS = require("exceljs");
const logger = require("../config/logger");
const { pool } = require("../config/db");

// ============================================================================
// Pagos de préstamos EPQ: cálculo de cada pago y carga masiva por Excel.
//
// Reglas (confirmadas con los préstamos ya cargados, 2026-11-04):
//   - Monto descontado = cuota pagada + seguro. El seguro se cobra primero (el del
//     último pago del préstamo; si lo descontado no alcanza, se cobra lo que haya).
//   - Intereses = saldo anterior × tasa anual ÷ 12.
//   - Amortización = cuota pagada − intereses (si no alcanza queda negativa y el
//     saldo sube: los intereses no pagados se suman al saldo).
//   - Saldo = saldo anterior − amortización (nunca menor que cero).
//   - Mora = (cuota nivelada − cuota pagada) × 2% diario × días del mes; se anota
//     aparte, no se suma al saldo. Si paga más que la cuota: mora 0 y el extra
//     abona a capital.
// ============================================================================
const MORA_DIARIA = 0.02;
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const createError = (message, status = 400) => { const e = new Error(message); e.status = status; return e; };
const diasDelMes = (fecha) => { const [y, m] = String(fecha).split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

// Calcula un pago a partir del estado anterior del préstamo.
const calcularPago = ({ saldoAnterior, tasaAnual, cuotaNivelada, seguroBase, montoDescontado, fecha }) => {
  const monto = r2(montoDescontado);
  const seguro = r2(Math.min(Number(seguroBase || 0), monto));
  const cuotaPagada = r2(monto - seguro);
  const intereses = r2((Number(saldoAnterior) * Number(tasaAnual)) / 1200);
  let amortizacion = r2(cuotaPagada - intereses);
  if (amortizacion > Number(saldoAnterior)) amortizacion = r2(saldoAnterior);
  const saldo = Math.max(r2(Number(saldoAnterior) - amortizacion), 0);
  const faltante = r2(Number(cuotaNivelada) - cuotaPagada);
  const mora = faltante > 0 ? r2(faltante * MORA_DIARIA * diasDelMes(fecha)) : 0;
  return { fechaPago: fecha, descuentoNominaAportacion: monto, cuotaNivelada: cuotaPagada, amortizacion, intereses, saldo, mora, seguro };
};

// Estado del préstamo: datos del préstamo y su último pago.
const estadoPrestamo = async (idPrestamo, executor = pool) => {
  const [[p]] = await executor.query(
    `SELECT p.pre_correlativo AS id, p.pre_monto_autorizado AS monto, p.pre_tasa_interes AS tasa, p.pre_cuota_nivelada AS cuota,
            p.pre_estado AS estado, p.pre_no_contrato AS contrato, p.pre_id_aportacion AS idAportacion,
            (SELECT d.dpr_saldo FROM RPJ_MNT_DETALLE_PRESTAMO d WHERE d.dpr_id_prestamo = p.pre_correlativo ORDER BY d.dpr_fecha_pago DESC, d.dpr_correlativo DESC LIMIT 1) AS saldo,
            (SELECT d.dpr_seguro FROM RPJ_MNT_DETALLE_PRESTAMO d WHERE d.dpr_id_prestamo = p.pre_correlativo AND d.dpr_seguro > 0 ORDER BY d.dpr_fecha_pago DESC, d.dpr_correlativo DESC LIMIT 1) AS seguro,
            (SELECT DATE_FORMAT(MAX(d.dpr_fecha_pago), '%Y-%m-%d') FROM RPJ_MNT_DETALLE_PRESTAMO d WHERE d.dpr_id_prestamo = p.pre_correlativo) AS ultimaFecha
       FROM RPJ_MNT_PRESTAMO p WHERE p.pre_correlativo = ?`, [idPrestamo]
  );
  if (!p) throw createError("Préstamo no encontrado", 404);
  return { ...p, saldo: p.saldo === null ? Number(p.monto) : Number(p.saldo), seguro: Number(p.seguro || 0), tasa: Number(p.tasa), cuota: Number(p.cuota) };
};

// Vista previa de un pago (pantalla Detalle de préstamo): { fechaPago, monto }.
const calcular = async (idPrestamo, body) => {
  const fecha = String(body?.fechaPago || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw createError("Indique la fecha de pago");
  const monto = Number(String(body?.monto ?? "").replace(/,/g, ""));
  if (!(monto >= 0)) throw createError("Indique el monto descontado");
  const e = await estadoPrestamo(idPrestamo);
  return calcularPago({ saldoAnterior: e.saldo, tasaAnual: e.tasa, cuotaNivelada: e.cuota, seguroBase: e.seguro, montoDescontado: monto, fecha });
};

// Graba los pagos de un préstamo (en orden de fecha) con las mismas reglas que la
// carga masiva: un pago por mes, nunca antes del último pago y no si ya está saldado.
// Si el saldo llega a 0, el préstamo queda CANCELADO. Devuelve los pagos grabados.
const registrarPagos = async (conn, idPrestamo, lista, usuario, resumen) => {
  const e = await estadoPrestamo(idPrestamo, conn);
  const [meses] = await conn.query(
    "SELECT DISTINCT DATE_FORMAT(dpr_fecha_pago, '%Y-%m') AS m FROM RPJ_MNT_DETALLE_PRESTAMO WHERE dpr_id_prestamo = ?", [idPrestamo]
  );
  const yaTiene = new Set(meses.map((x) => x.m));
  let saldo = e.saldo;
  let ultima = e.ultimaFecha;
  const grabados = [];
  for (const f of lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.fila - b.fila)) {
    const mes = f.fecha.slice(0, 7);
    if (yaTiene.has(mes)) { resumen.errores.push({ fila: f.fila, codigo: f.codigo, error: `El préstamo ${e.contrato} ya tiene un pago en ${mes.split("-").reverse().join("/")}` }); continue; }
    if (ultima && f.fecha <= ultima) { resumen.errores.push({ fila: f.fila, codigo: f.codigo, error: `El préstamo ${e.contrato} ya tiene pagos posteriores (último ${ultima.split("-").reverse().join("/")})` }); continue; }
    if (saldo <= 0) { resumen.errores.push({ fila: f.fila, codigo: f.codigo, error: `El préstamo ${e.contrato} ya está saldado` }); continue; }
    const p = calcularPago({ saldoAnterior: saldo, tasaAnual: e.tasa, cuotaNivelada: e.cuota, seguroBase: e.seguro, montoDescontado: f.monto, fecha: f.fecha });
    await conn.execute(
      `INSERT INTO RPJ_MNT_DETALLE_PRESTAMO (dpr_id_prestamo, dpr_fecha_pago, dpr_descuento_nomina_aportacion, dpr_cuota_nivelada,
         dpr_amortizacion, dpr_intereses, dpr_saldo, dpr_mora, dpr_seguro, dpr_usuario_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [idPrestamo, p.fechaPago, p.descuentoNominaAportacion, p.cuotaNivelada, p.amortizacion, p.intereses, p.saldo, p.mora, p.seguro, usuario]
    );
    resumen.grabados += 1;
    grabados.push(p);
    yaTiene.add(mes); saldo = p.saldo; ultima = f.fecha;
  }
  // Préstamo saldado: queda CANCELADO y el empleado sin préstamo activo.
  if (saldo <= 0 && e.saldo > 0) {
    await conn.execute("UPDATE RPJ_MNT_PRESTAMO SET pre_estado = 'CANCELADO' WHERE pre_correlativo = ?", [idPrestamo]);
    await conn.execute("UPDATE RPJ_MNT_APORTACION_EPQ SET apo_tiene_prestamo = 0 WHERE apo_correlativo = ?", [e.idAportacion]);
    resumen.prestamosSaldados.push(e.contrato);
  }
  return grabados;
};

// Pago individual (acción "Registrar pago" del Detalle de préstamos): igual que una
// fila de la carga masiva, pero para un préstamo elegido. body: { fechaPago, monto }.
const pagoIndividual = async (idPrestamo, body, currentUser) => {
  const fecha = String(body?.fechaPago || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw createError("Indique la fecha de pago");
  const raw = String(body?.monto ?? "").replace(/[Q,\s]/g, "");
  const monto = Number(raw);
  if (raw === "" || Number.isNaN(monto) || monto < 0) throw createError("Indique el monto descontado");
  const e = await estadoPrestamo(idPrestamo);
  if (["CANCELADO", "ANULADO"].includes(String(e.estado).toUpperCase())) throw createError(`El préstamo ${e.contrato} está ${e.estado}`);
  const usuario = currentUser?.usuario || "sistema";
  const resumen = { totalFilas: 1, grabados: 0, errores: [], prestamosSaldados: [] };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [pago] = await registrarPagos(conn, idPrestamo, [{ fila: 1, codigo: "", fecha, monto: r2(monto) }], usuario, resumen);
    if (!pago) throw createError(resumen.errores[0]?.error || "No fue posible registrar el pago");
    await conn.commit();
    logger.info("Pago individual de préstamo", { idPrestamo, fecha, monto, usuario });
    return { ...pago, contrato: e.contrato, saldado: resumen.prestamosSaldados.length > 0 };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ---- Carga masiva -----------------------------------------------------------
const normalizar = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
const COLUMNAS = [
  { key: "codigo", aliases: ["codigo empleado", "codigo", "id empleado", "idempleado", "empleado", "cod empleado"] },
  { key: "fecha", aliases: ["fecha pago", "fecha", "fecha_pago", "fechapago", "fecha de pago"] },
  { key: "monto", aliases: ["monto descontado", "monto", "descuento", "valor", "pago", "monto pagado"] }
];
const valorCelda = (v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") { if (v.text !== undefined) return v.text; if (v.result !== undefined) return v.result; if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join(""); }
  return v;
};
const pad = (n) => String(n).padStart(2, "0");
const aFecha = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
};

const cargaMasiva = async (buffer, currentUser) => {
  if (!buffer || !buffer.length) throw createError("No se recibió ningún archivo o está vacío");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw createError("El archivo no es un Excel válido (.xlsx)"); }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw createError("El archivo no contiene datos");
  const col = {};
  ws.getRow(1).eachCell((c, n) => {
    const h = normalizar(valorCelda(c.value));
    COLUMNAS.forEach((x) => { if (col[x.key] === undefined && x.aliases.includes(h)) col[x.key] = n; });
  });
  if (COLUMNAS.some((x) => col[x.key] === undefined)) throw createError("El Excel debe tener las columnas: CODIGO EMPLEADO, FECHA PAGO, MONTO DESCONTADO");

  const resumen = { totalFilas: 0, grabados: 0, errores: [], prestamosSaldados: [] };
  const filas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const codigo = String(valorCelda(row.getCell(col.codigo).value)).trim();
    const rawFecha = valorCelda(row.getCell(col.fecha).value);
    const rawMonto = valorCelda(row.getCell(col.monto).value);
    if (!codigo && !String(rawFecha).trim() && String(rawMonto).trim() === "") return;
    resumen.totalFilas += 1;
    const fecha = aFecha(rawFecha);
    const monto = Number(String(rawMonto).replace(/[Q,\s]/g, ""));
    if (!codigo) return resumen.errores.push({ fila: n, error: "Falta el código de empleado" });
    if (!fecha) return resumen.errores.push({ fila: n, codigo, error: "Fecha inválida (use DD/MM/AAAA)" });
    if (String(rawMonto).trim() === "" || Number.isNaN(monto) || monto < 0) return resumen.errores.push({ fila: n, codigo, error: "Monto inválido" });
    filas.push({ fila: n, codigo, fecha, monto: r2(monto) });
  });

  // Préstamo vigente (o atrasado) de cada código.
  const codigos = [...new Set(filas.map((f) => f.codigo))];
  const prestamoDe = new Map();
  if (codigos.length) {
    const [ps] = await pool.query(
      `SELECT a.apo_id AS codigo, p.pre_correlativo AS id FROM RPJ_MNT_PRESTAMO p
         JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = p.pre_id_aportacion
        WHERE a.apo_id IN (?) AND p.pre_estado IN ('VIGENTE', 'ATRASADO', 'ACTIVO')`, [codigos]
    );
    ps.forEach((x) => { const k = String(x.codigo); prestamoDe.set(k, [...(prestamoDe.get(k) || []), x.id]); });
  }

  const usuario = currentUser?.usuario || "sistema";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const porPrestamo = new Map();
    filas.forEach((f) => {
      const ids = prestamoDe.get(String(f.codigo)) || [];
      if (!ids.length) return resumen.errores.push({ fila: f.fila, codigo: f.codigo, error: "No tiene préstamo vigente" });
      if (ids.length > 1) return resumen.errores.push({ fila: f.fila, codigo: f.codigo, error: `Tiene ${ids.length} préstamos vigentes: regístrelo en su préstamo desde la pantalla` });
      porPrestamo.set(ids[0], [...(porPrestamo.get(ids[0]) || []), f]);
    });

    for (const [idPrestamo, lista] of porPrestamo) {
      await registrarPagos(conn, idPrestamo, lista, usuario, resumen);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  resumen.errores.sort((a, b) => a.fila - b.fila);
  logger.info("Carga masiva de pagos de préstamos", { filas: resumen.totalFilas, grabados: resumen.grabados, errores: resumen.errores.length, usuario });
  return resumen;
};

const plantilla = async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RPJEPQ";
  const ws = wb.addWorksheet("Pagos");
  ws.columns = [{ header: "CODIGO EMPLEADO", width: 18 }, { header: "FECHA PAGO", width: 14 }, { header: "MONTO DESCONTADO", width: 20 }];
  const enc = ws.getRow(1);
  enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  enc.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E5F" } }; c.alignment = { horizontal: "center" }; });
  ws.getColumn(2).numFmt = "dd/mm/yyyy";
  ws.getColumn(3).numFmt = "#,##0.00";
  const inst = wb.addWorksheet("Instrucciones");
  inst.getColumn(1).width = 110;
  [
    "CARGA MASIVA DE PAGOS DE PRÉSTAMOS EPQ",
    "",
    "1. Llene la hoja \"Pagos\" (la primera). No cambie los encabezados.",
    "2. CODIGO EMPLEADO: el código del empleado EPQ. Debe tener UN préstamo VIGENTE o ATRASADO.",
    "3. FECHA PAGO: fecha del descuento (DD/MM/AAAA). Puede haber varias fechas en el mismo archivo; un pago por préstamo por mes.",
    "4. MONTO DESCONTADO: lo que realmente se le descontó (cuota + seguro), aunque sea menor o mayor que la cuota. Puede ser 0.",
    "",
    "El sistema calcula: seguro (el del último pago), intereses (saldo × tasa ÷ 12), amortización, saldo y mora",
    "(lo que faltó de la cuota × 2% diario × días del mes). Si paga de más, el extra abona a capital.",
    "Se rechazan las filas de meses que el préstamo ya tiene o anteriores a su último pago. Si el saldo llega a 0, el préstamo queda CANCELADO."
  ].forEach((t) => inst.addRow([t]));
  inst.getRow(1).font = { bold: true, size: 13 };
  return { buffer: await wb.xlsx.writeBuffer(), filename: "plantilla_pagos_prestamos.xlsx" };
};

module.exports = { calcularPago, calcular, cargaMasiva, plantilla, pagoIndividual };
