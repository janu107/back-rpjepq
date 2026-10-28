// Prueba del pago a beneficiarios de un jubilado fallecido (base LOCAL rpj_pruebas).
// Reglas (confirmadas 2026-10-28): la esposa cobra lo que recibía él (50% de su
// líquido) abonando a la deuda del fallecido; al terminar esa deuda pasa a VIUDEZ
// (su % de la pensión, se paga 50%). Los hijos cobran ORFANDAD (su %, se paga 50%)
// y a los 18 se les liquida de una vez lo que se les debe.
//   MYSQL_BIN=/opt/homebrew/opt/mysql@8.0/bin/mysql node pruebas/planilla-jubilados/beneficiarios.test.js
const path = require("path");
const B = path.resolve(__dirname, "../..");
const m = require(B + "/node_modules/mysql2/promise");
const { execSync } = require("child_process");
const SEED = path.join(__dirname, "datos_ficticios.sql");
const MYSQL = process.env.MYSQL_BIN || "mysql";

let fallas = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ✅" : "  ❌"} ${msg}`); if (!cond) fallas++; };
const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  execSync(`${MYSQL} -u root rpj_pruebas < "${SEED}"`);
  const c = await m.createConnection({ host: "127.0.0.1", user: "root", database: "rpj_pruebas" });
  const q = async (s, p) => (await c.query(s, p))[0];
  const hoy = new Date();
  const per = (d) => d.getFullYear() * 100 + d.getMonth() + 1;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const mes = (k) => new Date(mesActual.getFullYear(), mesActual.getMonth() + k, 1);
  const finMes = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  // Deuda de Juan (jubilado 1) desde enero 2023: 8,000 de pensión, 5,985 de líquido.
  await c.query("CALL sp_carga_historica_jubilados(202301, 50, 'prueba', @j,@p,@r,@d,@e,@a,@i,@f)");
  const pendFall = async () => Number((await q("SELECT COALESCE(SUM(deu_monto_pendiente),0) p FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado=1"))[0].p);
  const pend0 = await pendFall();
  ok(pend0 > 0, `Juan tiene deuda: ${pend0}`);

  // Beneficiarios: esposa 50%, hijo menor 25% (con tutora) y un hijo que cumple 18 el mes siguiente.
  const cumple18 = mes(1); // cumple 18 el primer día del mes siguiente
  const nac18 = ymd(new Date(cumple18.getFullYear() - 18, cumple18.getMonth(), 1));
  await c.query(`INSERT INTO RPJ_MNT_BENEFICIARIO (ben_correlativo, ben_id_jubilado, ben_tipo_parentesco, ben_nombres, ben_apellidos, ben_dpi, ben_fecha_nacimiento, ben_porcentaje, ben_estado, ben_fecha_registro, ben_usuario_creacion) VALUES
    (901, 1, 'ESPOSA', 'MARIA', 'PEREZ', '9000000000101', '1960-01-01', 50, 'REGISTRADO', CURDATE(), 'prueba'),
    (902, 1, 'HIJO', 'NENE', 'PEREZ', '9000000000102', '2015-05-05', 25, 'REGISTRADO', CURDATE(), 'prueba'),
    (903, 1, 'HIJO', 'GRANDE', 'PEREZ', '9000000000103', ?, 25, 'REGISTRADO', CURDATE(), 'prueba')`, [nac18]);
  await c.query(`INSERT INTO RPJ_MNT_TUTOR (tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi, tut_fecha_inicio, tut_usuario_creacion) VALUES
    (902, 'MARIA', 'PEREZ', '9000000000101', CURDATE(), 'prueba'), (903, 'MARIA', 'PEREZ', '9000000000101', CURDATE(), 'prueba')`);

  console.log("== Registrar fallecimiento");
  let fallo = null;
  try { await c.query("CALL sp_registrar_fallecimiento_jubilado(5, CURDATE(), 'X', 'prueba', @a, @b)"); } catch (e) { fallo = e.message; }
  ok(fallo && /beneficiarios|pension/i.test(fallo), "no se registra el fallecimiento sin beneficiarios o sin pensión");
  await c.query("CALL sp_registrar_fallecimiento_jubilado(1, ?, 'DEF-1', 'prueba', @a, @b)", [ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 5))]);
  const [[act]] = await c.query("SELECT COUNT(*) n FROM RPJ_MNT_BENEFICIARIO WHERE ben_id_jubilado=1 AND ben_estado='ACTIVO'");
  ok(act.n === 3, "los 3 beneficiarios quedan ACTIVOS");

  const filas = async (pla) => q("SELECT nin_id_beneficiario b, nin_puesto concepto, nin_valor v, nin_valor_teorico t FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla=? AND nin_id_beneficiario IS NOT NULL ORDER BY b", [pla]);
  const deudaBen = async (b) => q("SELECT dbe_periodo p, dbe_monto_original o, dbe_monto_pagado pg, dbe_monto_pendiente pend, dbe_estado e FROM RPJ_PRC_DEUDA_BENEFICIARIO WHERE dbe_id_beneficiario=? ORDER BY dbe_periodo", [b]);
  const nuevaPlanilla = async (id, d) => {
    await c.query(`INSERT INTO RPJ_CAT_PARAMETRO_PLANILLA (ppl_correlativo, ppl_tipo_planilla, ppl_numero, ppl_fecha_inicio, ppl_fecha_final, ppl_fecha_pago, ppl_frecuencia, ppl_estado, ppl_aplica_porcentaje, ppl_porcentaje_pago, ppl_estado_proceso, ppl_usuario_creacion)
      VALUES (?, 2, ?, ?, ?, ?, 'MENSUAL', 'ACTIVO', 1, 50.00, 'ABIERTA', 'prueba')`, [id, per(d), ymd(d), ymd(finMes(d)), ymd(finMes(d))]);
  };
  const generar = (pla) => c.query("CALL sp_generar_nomina_pensionados(?, 1, 'prueba', @a, @b, @c, @d)", [pla]);
  const cerrar = async (pla) => { await c.query("CALL sp_cuadrar_planilla_pensionados(?, 'prueba', @aj)", [pla]); await c.query("CALL sp_cerrar_planilla(?, 'prueba')", [pla]); };

  console.log(`== Planilla del mes (${per(mesActual)}): primer mes de los beneficiarios`);
  await generar(900);
  let f = await filas(900);
  const [[juan]] = await c.query("SELECT COUNT(*) n FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla=900 AND nin_id_jubilado=1 AND nin_id_beneficiario IS NULL");
  ok(juan.n === 0, "Juan (fallecido) ya no entra a la nómina");
  ok(f.length === 3, "entran los 3 beneficiarios");
  ok(f[0] && f[0].concepto === "COBRO DEUDA DEL FALLECIDO" && eq(f[0].v, 2992.50), "esposa: cobra lo que recibía él (50% de 5,985 = 2,992.50) para la deuda");
  ok(f[1] && f[1].concepto === "ORFANDAD" && eq(f[1].t, 2000) && eq(f[1].v, 1000), "hijo menor: orfandad 25% de 8,000 = 2,000, se paga 1,000");
  ok(f[2] && f[2].concepto === "ORFANDAD" && eq(f[2].v, 1000), "hijo que aún no cumple 18: orfandad 1,000");
  ok(eq(await pendFall(), pend0), "al generar la deuda del fallecido no cambia");

  console.log("== Reversar y generar de nuevo");
  await c.query("CALL sp_reversar_planilla_pensionados(900, 'prueba', 'test')");
  ok((await filas(900)).length === 0, "al reversar se quitan los renglones de beneficiarios");
  await generar(900);
  ok((await filas(900)).length === 3, "al generar de nuevo vuelven");

  console.log("== Cerrar");
  await cerrar(900);
  ok(eq(await pendFall(), pend0 - 2992.50), "la deuda del fallecido baja 2,992.50 (abono de la esposa)");
  const [[apa]] = await c.query("SELECT COUNT(*) n FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla=900 AND apa_id_jubilado=1 AND apa_observaciones LIKE 'Beneficiario%'");
  ok(apa.n >= 1, "queda registrado con qué planilla se abonó la deuda del fallecido");
  let d2 = await deudaBen(902);
  ok(d2.length === 1 && d2[0].p === per(mesActual) && eq(d2[0].o, 2000) && eq(d2[0].pg, 1000) && eq(d2[0].pend, 1000), "hijo: el mes queda debiendo 2,000, pagado 1,000, pendiente 1,000");

  console.log(`== Planilla siguiente (${per(mes(1))}): el hijo mayor cumple 18`);
  await nuevaPlanilla(901, mes(1));
  await generar(901);
  f = await filas(901);
  if (process.env.DEBUG) { console.log(f, await deudaBen(903), await deudaBen(902), await q("SELECT ppl_correlativo, ppl_numero, ppl_fecha_inicio FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo IN (900,901)"), nac18); }
  const grande = f.find((x) => x.b === 903);
  ok(grande && grande.concepto === "LIQUIDACION ORFANDAD" && eq(grande.v, 1000), "hijo que cumplió 18: se le paga de una vez lo que se le debe (1,000)");
  await cerrar(901);
  const [[est903]] = await c.query("SELECT ben_estado e FROM RPJ_MNT_BENEFICIARIO WHERE ben_correlativo=903");
  ok(est903.e === "INACTIVO", "después de la liquidación queda INACTIVO");
  ok((await deudaBen(903)).every((x) => eq(x.pend, 0)), "ya no se le debe nada");
  d2 = await deudaBen(902);
  ok(d2.length === 2 && eq(d2[0].pend, 0) && eq(d2[1].pend, 2000), "hijo menor: el pago se abona al mes más viejo (pendiente del mes nuevo 2,000)");

  console.log("== Termina la deuda del fallecido -> VIUDEZ");
  // Se deja solo 500 pendiente para la prueba.
  await c.query(`UPDATE RPJ_PRC_DEUDA_JUBILADO SET deu_monto_pagado=deu_monto_original, deu_monto_pendiente=0, deu_estado='PAGADA' WHERE deu_id_jubilado=1`);
  await c.query(`UPDATE RPJ_PRC_DEUDA_JUBILADO SET deu_monto_pagado=deu_monto_original-500, deu_monto_pendiente=500, deu_estado='PARCIAL' WHERE deu_id_jubilado=1 ORDER BY deu_periodo DESC LIMIT 1`);
  await nuevaPlanilla(902, mes(2));
  await generar(902);
  f = await filas(902);
  ok(f[0] && f[0].concepto === "COBRO DEUDA DEL FALLECIDO" && eq(f[0].v, 500), "esposa: el último pago es solo lo que falta (500)");
  ok(!f.some((x) => x.b === 903), "el hijo inactivo ya no entra");
  await cerrar(902);
  ok(eq(await pendFall(), 0), "deuda del fallecido saldada");
  await nuevaPlanilla(903, mes(3));
  await generar(903);
  f = await filas(903);
  ok(f[0] && f[0].concepto === "VIUDEZ" && eq(f[0].t, 4000) && eq(f[0].v, 2000), "esposa: la planilla siguiente pasa a VIUDEZ: 50% de 8,000 = 4,000, se paga 2,000");
  await cerrar(903);
  const dv = await deudaBen(901);
  ok(dv.length === 1 && dv[0].p === per(mes(3)) && eq(dv[0].pend, 2000), "viudez: empieza ese mes (no se le debe antes) y queda pendiente 2,000");

  // Limpieza para que las otras pruebas partan de cero.
  if (!process.env.KEEP) execSync(`${MYSQL} -u root rpj_pruebas < "${SEED}"`);
  await c.end();
  console.log(fallas ? `\n❌ ${fallas} verificación(es) fallaron` : "\n✅ Todas las verificaciones pasaron");
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
