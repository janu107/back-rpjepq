// Prueba de la regla del 50% sobre el líquido (modelo del Excel "juan perez")
// en la base LOCAL rpj_pruebas. Nunca toca producción.
//   MYSQL_BIN=/opt/homebrew/opt/mysql@8.0/bin/mysql node pruebas/planilla-jubilados/regla_50_liquido.test.js
const path = require("path");
const B = path.resolve(__dirname, "../..");
const m = require(B + "/node_modules/mysql2/promise");
const { execSync } = require("child_process");
const SEED = path.join(__dirname, "datos_ficticios.sql");
const MYSQL = process.env.MYSQL_BIN || "mysql";
const PERIODO_DEUDA = 202301; // Deuda desde enero 2023 (acordado con el área usuaria)

let fallas = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ✅" : "  ❌"} ${msg}`); if (!cond) fallas++; };
const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const r2 = (n) => Math.round(n * 100) / 100;
const mesesEntre = (desde, hasta) => (Math.floor(hasta / 100) - Math.floor(desde / 100)) * 12 + (hasta % 100) - (desde % 100) + 1;

(async () => {
  execSync(`${MYSQL} -u root rpj_pruebas < "${SEED}"`);
  const c = await m.createConnection({ host: "127.0.0.1", user: "root", database: "rpj_pruebas" });
  const q = async (s, p) => (await c.query(s, p))[0];
  const hoy = new Date();
  const periodoActual = hoy.getFullYear() * 100 + hoy.getMonth() + 1;
  const prev = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const periodoFin = prev.getFullYear() * 100 + prev.getMonth() + 1;

  const deudas = (jub) => q("SELECT deu_periodo p, deu_monto_original o, deu_monto_pagado pg, deu_monto_pendiente pend, deu_estado e, deu_id_planilla pla FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado=? ORDER BY deu_periodo", [jub]);
  const pendiente = async (jub) => (await deudas(jub)).reduce((s, d) => s + Number(d.pend), 0);
  const fila = async (jub) => {
    const [i] = await q("SELECT * FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla=900 AND nin_id_jubilado=?", [jub]);
    const [d] = await q("SELECT COALESCE(SUM(nde_valor),0) t FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla=900 AND nde_id_jubilado=?", [jub]);
    return i ? { ingreso: Number(i.nin_valor), mes: Number(i.nin_pago_corriente), anterior: Number(i.nin_abono_historico), desc: Number(d.t), neto: r2(i.nin_valor - d.t) } : null;
  };
  const prestamos = async () => Object.fromEntries((await q("SELECT prr_correlativo id, prr_saldo s FROM RPJ_MNT_PRESTAMOS_REGIMEN")).map((r) => [r.id, Number(r.s)]));

  // ---------------------------------------------------------------- carga histórica
  console.log(`== CARGA HISTÓRICA (deuda desde ${PERIODO_DEUDA}, 50%, hasta ${periodoFin})`);
  await c.query("CALL sp_carga_historica_jubilados(?, 50, 'prueba', @j,@p,@r,@d,@e,@a,@i,@f)", [PERIODO_DEUDA]);
  console.log("  salida:", (await q("SELECT @j jubilados, @p planillas, @r renglones, @d deudas, @a pendientes, @i inicio, @f fin"))[0]);

  // Juan: 5,985 por mes (8000 − 15 − 2000); cada mes se le pagó 2,992.50.
  const n = mesesEntre(PERIODO_DEUDA, periodoFin);
  const dJ = await deudas(1);
  ok(dJ.length === n && dJ.every((d) => eq(d.o, 5985)), `Juan: ${n} meses adeudados de 5,985 desde ${PERIODO_DEUDA}`);
  ok(dJ[0].p === PERIODO_DEUDA, "Juan: la deuda empieza en el período indicado");
  ok(dJ.every((d) => d.e === "PARCIAL" && eq(d.pend, 2992.50)),
    "Juan: desde enero 2023 cada mes se pagó la mitad y la otra mitad (2,992.50) queda como deuda");
  ok(eq(await pendiente(1), r2(n * 5985 / 2)), `Juan: debe la mitad de todo lo devengado = ${r2(n * 5985 / 2)}`);
  const [febJuan] = await q("SELECT i.nin_valor v, i.nin_porcentaje_aplicado pct FROM RPJ_PRC_NOMINA_INGRESO i JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo=i.nin_id_planilla WHERE p.ppl_numero=202212 AND i.nin_id_jubilado=1");
  ok(febJuan && eq(febJuan.pct, 100) && eq(febJuan.v, 8000), "Juan: diciembre 2022 se pagó completo (planilla histórica al 100%)");

  // Ana: entró el 15/06/2025 -> junio proporcional (16 de 30 días) y deuda desde ahí.
  const dA = await deudas(2);
  ok(dA[0].p === 202506 && eq(dA[0].o, 3185), "Ana (ingresó 2025): primer mes junio 2025 proporcional = 3,200 − 15 = 3,185");
  ok(dA.length === mesesEntre(202506, periodoFin), "Ana: deuda solo desde su fecha de ingreso");
  ok(eq(await pendiente(2), r2(dA.reduce((s, d) => s + Number(d.o), 0) / 2)), "Ana: debe la mitad de lo devengado desde que ingresó");

  // Beto: préstamo BI desde 2024 -> 2023 vale 4,985 y 2024 en adelante 4,485.
  const dB = await deudas(3);
  ok(eq(dB.find((d) => d.p === 202312).o, 4985) && eq(dB.find((d) => d.p === 202401).o, 4485), "Beto: el préstamo cuenta solo en los meses vigentes (dic-23 4,985; ene-24 4,485)");
  ok((await deudas(5)).length === 0, "Elsa (sin pensión registrada): no genera deuda");
  const dF = await deudas(6);
  ok(eq(dF.find((d) => d.p === 202303).o, 4685) && eq(dF.find((d) => d.p === 202406).o, 4685),
    "Fabio: 2023 a jun-2024 resta el préstamo viejo ya terminado (INACTIVO): 5000 − 15 − 300 = 4,685");
  ok(eq(dF.find((d) => d.p === 202407).o, 4285) && eq(dF.find((d) => d.p === 202508).o, 4285),
    "Fabio: desde jul-2024 resta el préstamo renovado en otro banco: 5000 − 15 − 700 = 4,285");
  const [[descF]] = await c.query("SELECT GROUP_CONCAT(d.nde_tipo_descuento ORDER BY d.nde_tipo_descuento) t FROM RPJ_PRC_NOMINA_DESCUENTO d JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo=d.nde_id_planilla WHERE p.ppl_numero=202303 AND d.nde_id_jubilado=6");
  ok(descF.t === "5,8", "Fabio: en la historia el descuento sale como PRÉSTAMO BANRURAL + ASOCIACIÓN (el ANULADO no cuenta)");
  const [[renJuan]] = await c.query("SELECT COUNT(*) n FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla=899 AND nin_id_jubilado=1");
  ok(renJuan.n === 1, "Juan: el mes anterior (planilla real sin su renglón) se completa con su pago del 50%");
  const [[betoAnt]] = await c.query("SELECT nin_valor v FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla=899 AND nin_id_jubilado=3");
  ok(betoAnt && eq(betoAnt.v, 2500), "Beto: su renglón real del mes anterior no se toca");

  const pendJuanAntes = await pendiente(1);
  console.log("== Repetir la carga histórica (debe dar lo mismo)");
  await c.query("CALL sp_carga_historica_jubilados(?, 50, 'prueba', @j,@p,@r,@d,@e,@a,@i,@f)", [PERIODO_DEUDA]);
  ok(eq(await pendiente(1), pendJuanAntes) && (await deudas(1)).length === n, "segunda carga: mismo resultado");

  // ---------------------------------------------------------------- nómina del mes
  console.log(`== GENERAR nómina del mes actual (${periodoActual}): solo calcula, no toca la deuda`);
  await c.query("CALL sp_generar_nomina_pensionados(900, 1, 'prueba', @a, @b, @c, @d)");
  const fJ = await fila(1);
  console.log("  Juan:", fJ);
  ok(fJ && eq(fJ.desc, 2015) && eq(fJ.neto, 2992.50), "Juan recibe solo 2,992.50 (50% de 5,985)");
  ok(fJ && eq(fJ.anterior, 2992.50) && eq(fJ.mes, 0), "vista previa: el pago irá a la deuda más antigua");
  ok(eq(await pendiente(1), pendJuanAntes) && !(await deudas(1)).some((d) => d.p === periodoActual), "al generar la deuda no cambia ni aparece el mes actual");
  const fB = await fila(3);
  const [bi] = await q("SELECT nde_tipo_descuento t FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla=900 AND nde_id_prestamo=2");
  ok(fB && eq(fB.desc, 515) && bi && bi.t === 11, "Beto: préstamo BI descontado (tipo 'DESCUENTO PRESTAMO BI')");
  ok((await fila(5)) === null, "Elsa (sin pensión) no entra a la nómina");
  const fF = await fila(6);
  ok(fF && eq(fF.desc, 715), "Fabio: la nómina solo cobra el préstamo vigente (700 + 15); no el anulado ni el que empieza en el futuro");
  let pr = await prestamos();
  ok(eq(pr[1], 28000) && eq(pr[2], 5500) && eq(pr[3], 2700) && eq(pr[4], 6300), "saldos de préstamos rebajados una cuota");

  console.log("== Carga histórica con la planilla GENERADA (ahora se permite)");
  await c.query("CALL sp_carga_historica_jubilados(?, 50, 'prueba', @j,@p,@r,@d,@e,@a,@i,@f)", [PERIODO_DEUDA]);
  ok(eq(await pendiente(1), pendJuanAntes), "la carga no se altera por la planilla generada");

  console.log("== REVERSAR planilla completa");
  await c.query("CALL sp_reversar_planilla_pensionados(900, 'prueba', 'test')");
  ok(eq(await pendiente(1), pendJuanAntes), "Juan: la deuda queda igual");
  pr = await prestamos();
  ok(eq(pr[1], 30000) && eq(pr[2], 6000) && eq(pr[3], 3000) && eq(pr[4], 7000), "préstamos restaurados exactos (aun con 2 préstamos)");

  console.log("== VOLVER A GENERAR y reversar SOLO a Carla");
  await c.query("CALL sp_generar_nomina_pensionados(900, 1, 'prueba', @a, @b, @c, @d)");
  ok(eq((await fila(1)).neto, 2992.50), "regenerar da el mismo resultado");
  await c.query("CALL sp_reversar_pago_pensionado(900, 4, 'prueba', 'test')");
  pr = await prestamos();
  ok(eq(pr[3], 3000) && eq(pr[4], 7000) && eq(pr[1], 28000), "Carla: sus 2 préstamos restaurados; Juan no se afecta");
  ok((await fila(4)) === null && (await fila(1)) !== null, "Carla sale de la planilla; Juan sigue");

  console.log("== CERRAR: el mes entra a la deuda y el pago se abona al mes más antiguo");
  const pendAntesCierre = await pendiente(1);
  const turnoAntes = (await deudas(1)).find((d) => d.e !== "PAGADA");
  await c.query("CALL sp_cuadrar_planilla_pensionados(900, 'prueba', @aj)");
  await c.query("CALL sp_cerrar_planilla(900, 'prueba')");
  const dC = await deudas(1);
  const mesC = dC.find((d) => d.p === periodoActual);
  ok(mesC && eq(mesC.o, 5985) && eq(mesC.pend, 5985) && mesC.pla === 900, "el mes actual queda como deuda de 5,985 (100%)");
  const [[aplicadoA]] = await c.query("SELECT MIN(apa_periodo_deuda) p FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla=900 AND apa_id_jubilado=1");
  ok(turnoAntes && aplicadoA.p === turnoAntes.p, `el pago se abona al mes en turno (${turnoAntes && turnoAntes.p})`);
  ok(eq(await pendiente(1), r2(pendAntesCierre + 5985 - 2992.50)), "la deuda de Juan crece medio mes (+2,992.50)");
  const [[apl]] = await c.query("SELECT SUM(apa_monto_aplicado) t FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla=900 AND apa_id_jubilado=1");
  ok(eq(apl.t, 2992.50), "lo aplicado a la deuda = lo que recibe Juan");
  const [[est]] = await c.query("SELECT ppl_estado_proceso e FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo=900");
  ok(est.e === "CERRADA", "planilla CERRADA");

  console.log("== Repetir la CARGA HISTÓRICA con la nómina ya cerrada");
  const antes = await deudas(1);
  await c.query("CALL sp_carga_historica_jubilados(?, 50, 'prueba', @j,@p,@r,@d,@e,@a,@i,@f)", [PERIODO_DEUDA]);
  const despues = await deudas(1);
  ok(despues.length === antes.length && despues.every((d, k) => eq(d.pg, antes[k].pg) && eq(d.o, antes[k].o)),
    "repetir la carga respeta lo que pagó la nómina cerrada: cada mes queda igual");
  ok(despues.some((d) => d.p === periodoActual && d.pla === 900), "el mes de la nómina cerrada se conserva");

  await c.end();
  console.log(fallas ? `\n❌ ${fallas} verificaciones fallaron` : "\n✅ Todas las verificaciones pasaron");
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e.sqlMessage || e.message); process.exit(1); });
