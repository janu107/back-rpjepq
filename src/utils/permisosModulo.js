// ============================================================================
// Permisos por ventana (pantalla de Roles y permisos).
//
// Cada usuario tiene, por ventana del menú, un nivel:
//   CONSULTA (1): ver e imprimir.
//   OPERA    (2): ver, crear y modificar.
//   TOTAL    (3): todo lo anterior y además eliminar / revertir.
// Se guarda como una fila de rol "VENTANA:NIVEL" (ej. "REG_DIETAS:OPERA").
// También se aceptan permisos de módulo completo ("REGIMEN:OPERA") y los roles
// anteriores (OPERADOR, EPQ, CONSULTA…): valen para todas las ventanas de su módulo.
// ADMIN (superusuario) sigue aparte.
//
// Escribir (POST/PUT/PATCH/DELETE) exige el nivel en la ventana dueña de la ruta.
// Leer (GET) se permite si tiene alguna ventana del mismo módulo (las ventanas leen
// listas de otras del módulo, p. ej. Dietas lee la Junta Directiva).
// ============================================================================
const MODULOS = ["CATALOGOS", "EPQ", "REGIMEN", "JUBILADOS", "REPORTES"];
const NIVELES = { CONSULTA: 1, OPERA: 2, TOTAL: 3 };
const NEGOCIO = ["EPQ", "REGIMEN", "JUBILADOS"];

// grupo = como aparece en el menú; familias = módulo(s) al que pertenece la ventana.
// api = rutas del servidor (después de /api/) que son de esta ventana.
const PANTALLAS = [
  { clave: "CATALOGOS", grupo: "Catálogos", nombre: "Catálogos", detalle: "Bancos, áreas, puestos, tipos, parámetros y firmas", familias: ["CATALOGOS"], paths: ["/catalogos"], api: [/^catalogos(\/|$)/] },

  { clave: "EPQ_EMPLEADOS", grupo: "Mantenimiento EPQ", nombre: "Empleados EPQ", detalle: "Empleados que aportan y dashboard de aportaciones", familias: ["EPQ"], paths: ["/aportaciones", "/aportaciones-dashboard"], api: [/^aportaciones(?!\/(detalle|carga-masiva|\d+\/detalle))/] },
  { clave: "EPQ_APORTACIONES", grupo: "Mantenimiento EPQ", nombre: "Aportaciones", detalle: "Detalle de aportaciones y carga masiva", familias: ["EPQ"], paths: ["/aportaciones/detalle"], api: [/^aportaciones\/(detalle|carga-masiva|\d+\/detalle)/] },
  { clave: "EPQ_PRESTAMOS", grupo: "Mantenimiento EPQ", nombre: "Préstamos EPQ", detalle: "Préstamos y su detalle", familias: ["EPQ"], paths: ["/prestamos"], api: [/^prestamos(\/|$)/] },

  { clave: "REG_EMPLEADOS", grupo: "Proceso Régimen", nombre: "Control de Empleados", detalle: "Empleados del régimen, salarios y datos de pago", familias: ["REGIMEN"], paths: ["/empleados-regimen", "/empleados", "/salarios"], api: [/^(empleados|salarios|datos-planilla)(\/|$)/] },
  { clave: "REG_TIEMPO_EXTRA", grupo: "Proceso Régimen", nombre: "Tiempo Extraordinario", detalle: "Registro de horas extra", familias: ["REGIMEN"], paths: ["/tiempo-extra"], api: [/^tiempo-extra(\/|$)/] },
  { clave: "REG_JUNTA", grupo: "Proceso Régimen", nombre: "Juntas Directivas", detalle: "Miembros de las juntas", familias: ["REGIMEN"], paths: ["/junta-directiva"], api: [/^junta-directiva(\/|$)/] },
  { clave: "REG_DIETAS", grupo: "Proceso Régimen", nombre: "Pago Dietas", detalle: "Sesiones, asistencia y pago de dietas", familias: ["REGIMEN"], paths: ["/dietas"], api: [/^(dietas|sesiones)(\/|$)/] },
  { clave: "REG_DESC_JUDICIALES", grupo: "Proceso Régimen", nombre: "Descuentos Judiciales", detalle: "Embargos y pensiones alimenticias", familias: ["REGIMEN"], paths: ["/descuentos-judiciales"], api: [/^descuentos-judiciales(\/|$)/] },
  { clave: "REG_PRESTAMOS", grupo: "Proceso Régimen", nombre: "Préstamos Régimen", detalle: "Préstamos de bancos y asociación de los empleados", familias: ["REGIMEN"], paths: ["/prestamos-regimen"], api: [/^prestamos-regimen(\/|$)/] },

  { clave: "JUB_CONTROL", grupo: "Jubilados y Pensiones", nombre: "Control de Jubilados", detalle: "Jubilados, pensión y datos de pago", familias: ["JUBILADOS"], paths: ["/jubilados"], api: [/^jubilados(?!\/(fallecidos|fallecido-en-servicio|\d+\/(fallecimiento|deuda|forma-cobro|historia|liquidacion)))/, /^datos-planilla(\/|$)/] },
  { clave: "JUB_BENEFICIARIOS", grupo: "Jubilados y Pensiones", nombre: "Beneficiarios", detalle: "Viudas, huérfanos, tutores y montos", familias: ["JUBILADOS"], paths: ["/beneficiarios"], api: [/^beneficiarios(?!\/(suspendidos|\d+\/(suspender|reactivar)))/] },
  { clave: "JUB_FALLECIMIENTOS", grupo: "Jubilados y Pensiones", nombre: "Registrar Fallecimiento", detalle: "Fallecimientos, deuda pagada y forma de cobro", familias: ["JUBILADOS"], leeTambien: ["EPQ"], paths: ["/fallecimientos"], api: [/^jubilados\/(fallecidos|fallecido-en-servicio|\d+\/(fallecimiento|deuda|forma-cobro))/] },
  { clave: "JUB_AMPARISTAS", grupo: "Jubilados y Pensiones", nombre: "Amparistas", detalle: "Jubilados con amparo", familias: ["JUBILADOS"], paths: ["/amparistas"], api: [/^amparistas(\/|$)/] },
  { clave: "JUB_CONVENIOS", grupo: "Jubilados y Pensiones", nombre: "Convenios de Pago", detalle: "Convenios de deuda", familias: ["JUBILADOS"], paths: ["/convenios"], api: [/^convenios(\/|$)/] },
  { clave: "JUB_SUSPENSIONES", grupo: "Jubilados y Pensiones", nombre: "Suspensiones", detalle: "Suspender y reactivar beneficiarios", familias: ["JUBILADOS"], paths: ["/suspensiones"], api: [/^beneficiarios\/(suspendidos|\d+\/(suspender|reactivar))/] },
  { clave: "JUB_ESTADO_CUENTA", grupo: "Jubilados y Pensiones", nombre: "Estado de Cuenta", detalle: "Historia, ajustes de meses y liquidación", familias: ["JUBILADOS"], paths: ["/estado-cuenta"], api: [/^jubilados\/\d+\/(historia|liquidacion)/] },
  { clave: "JUB_REPORTES", grupo: "Jubilados y Pensiones", nombre: "Reportes y Dashboard", detalle: "Reportes de jubilados", familias: ["JUBILADOS"], paths: ["/reportes-jubilados"], api: [/^jubilados-reportes(\/|$)/] },
  { clave: "JUB_PRESTACIONES", grupo: "Jubilados y Pensiones", nombre: "Prestaciones Jubilados", detalle: "Bono 14 y aguinaldo de jubilados", familias: ["JUBILADOS"], paths: ["/prestaciones-jubilados"], api: [/^prestaciones-jubilados(\/|$)/] },
  { clave: "JUB_PRESTAMOS", grupo: "Jubilados y Pensiones", nombre: "Préstamos Jubilados", detalle: "Préstamos de bancos y asociación de los jubilados", familias: ["JUBILADOS"], paths: ["/prestamos-jubilados"], api: [/^prestamos-jubilados(\/|$)/] },

  { clave: "NOM_EMPLEADOS", grupo: "Nóminas", nombre: "Planilla de Empleados", detalle: "Generar, cerrar y reversar la planilla de empleados", familias: ["REGIMEN"], paths: ["/planillas-trabajadores", "/generacion-planilla"], api: [/^(planillas-trabajadores|generacion-planilla)(\/|$)/] },
  { clave: "NOM_JUBILADOS", grupo: "Nóminas", nombre: "Planilla de Jubilados y Amparistas", detalle: "Generar, cerrar y reversar la planilla de jubilados", familias: ["JUBILADOS"], paths: ["/planillas-pensionados", "/nominas-jubilados"], api: [/^(planillas-pensionados|nominas)(\/|$)/] },
  { clave: "NOM_TIEMPO_EXTRA", grupo: "Nóminas", nombre: "Nómina Tiempo Extra", detalle: "Planilla de horas extra", familias: ["REGIMEN"], paths: ["/nomina-tiempo-extra"], api: [/^nomina-tiempo-extra(\/|$)/] },
  { clave: "NOM_PRESTACIONES", grupo: "Nóminas", nombre: "Prestaciones (Bono 14 / Aguinaldo)", detalle: "Prestaciones de empleados", familias: ["REGIMEN"], paths: ["/prestaciones"], api: [/^prestaciones(\/|$)/] },
  { clave: "NOM_OTROS_DESC", grupo: "Nóminas", nombre: "Otros Descuentos", detalle: "Descuentos varios de la planilla", familias: ["REGIMEN"], paths: ["/otros-descuentos"], api: [/^otros-descuentos(\/|$)/] },
  { clave: "NOM_CONSULTA", grupo: "Nóminas", nombre: "Consulta Nómina", detalle: "Consulta de nóminas", familias: ["REGIMEN", "JUBILADOS"], paths: ["/nomina"], api: [/^nomina(\/|$)/] },

  { clave: "REP_IMPRESIONES", grupo: "Reportes", nombre: "Impresiones", detalle: "Nóminas, estados de cuenta, depósitos y oficios", familias: ["REPORTES"], paths: ["/impresiones", "/impresiones-jubilacion"], api: [/^impresiones(\/|$)/] },
  { clave: "REP_REPORTES", grupo: "Reportes", nombre: "Reportes de consulta", detalle: "Nómina, régimen, préstamos, junta y aportaciones", familias: ["REPORTES"], paths: ["/reportes"], api: [/^reportes(\/|$)/] }
];
const CLAVES = PANTALLAS.map((p) => p.clave);

// Roles anteriores -> nivel por módulo.
const EQUIVALENCIAS = {
  OPERADOR: { CATALOGOS: 2, EPQ: 2, REGIMEN: 2, JUBILADOS: 2, REPORTES: 1 },
  ADMINISTRACION: { CATALOGOS: 2, EPQ: 2, REGIMEN: 2, JUBILADOS: 2, REPORTES: 1 },
  CATALOGOS: { CATALOGOS: 2 },
  EPQ: { EPQ: 2 },
  REGIMEN: { REGIMEN: 2 },
  JUBILADOS: { JUBILADOS: 2 },
  REPORTES: { REPORTES: 1 },
  CONSULTA: { EPQ: 1, REGIMEN: 1, JUBILADOS: 1, REPORTES: 1 }
};

const partes = (rol) => String(rol || "").toUpperCase().split(":");
const esPermisoModulo = (rol) => { const [m, n] = partes(rol); return (MODULOS.includes(m) || CLAVES.includes(m)) && Boolean(NIVELES[n]); };

// { CLAVE_VENTANA: 0..3 } con el mayor nivel que dan todos sus roles.
const nivelesPorPantalla = (roles = []) => {
  const out = Object.fromEntries(CLAVES.map((c) => [c, 0]));
  const porModulo = (m, n) => PANTALLAS.forEach((p) => { if (p.familias.includes(m)) out[p.clave] = Math.max(out[p.clave], n); });
  roles.forEach((rol) => {
    const [a, b] = partes(rol);
    if (NIVELES[b] && CLAVES.includes(a)) out[a] = Math.max(out[a], NIVELES[b]);
    else if (NIVELES[b] && MODULOS.includes(a)) porModulo(a, NIVELES[b]);
    else if (EQUIVALENCIAS[a]) Object.entries(EQUIVALENCIAS[a]).forEach(([m, n]) => porModulo(m, n));
  });
  return out;
};

// { MODULO: 0..3 }: el mayor nivel de sus ventanas en cada módulo.
const nivelesPorModulo = (roles = []) => {
  const v = nivelesPorPantalla(roles);
  const out = Object.fromEntries(MODULOS.map((m) => [m, 0]));
  PANTALLAS.forEach((p) => p.familias.forEach((m) => { out[m] = Math.max(out[m], v[p.clave]); }));
  return out;
};

// Ventanas dueñas de una ruta del servidor ("jubilados/12/fallecimiento").
const pantallasDeRuta = (ruta) => PANTALLAS.filter((p) => p.api.some((rx) => rx.test(ruta)));

module.exports = { MODULOS, NIVELES, NEGOCIO, EQUIVALENCIAS, PANTALLAS, CLAVES, esPermisoModulo, nivelesPorPantalla, nivelesPorModulo, pantallasDeRuta };
