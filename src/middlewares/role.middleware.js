const logger = require("../config/logger");
const { auditFromRequest } = require("./audit.middleware");

// ============================================================================
// Autorización por rol. Los endpoints siguen declarando los roles ORIGINALES
// (authorizeRoles("ADMIN", "OPERADOR", ...)); aquí cada usuario —que puede tener
// varios roles— se traduce al nivel que le corresponde SEGÚN EL MÓDULO que
// pide, y ese nivel se compara contra los permitidos del endpoint:
//
//   ADMIN           -> ADMIN (todo, incluido usuarios/roles/auditoría)
//   OPERADOR        -> OPERADOR en todos los módulos (rol anterior)
//   ADMINISTRACION  -> OPERADOR en todos los módulos: ver, crear y modificar,
//                      pero no eliminar ni administrar usuarios/roles
//   EPQ/REGIMEN/JUBILADOS -> OPERADOR sólo dentro de su módulo (+ ver sus reportes)
//   CATALOGOS       -> OPERADOR en catálogos (Manejo administración: sólo lectura)
//   REPORTES        -> sólo lectura de reportes e impresiones
//   CONSULTA        -> sólo lectura (GET) de EPQ, Régimen y Jubilados, y reportes
//
// Además, cualquier usuario con un rol nuevo puede LEER los catálogos, porque
// los formularios de todos los módulos los usan para sus listas desplegables.
// ============================================================================

const MODULOS_URL = {
  aportaciones: ["EPQ"],
  prestamos: ["EPQ"],

  empleados: ["REGIMEN"],
  salarios: ["REGIMEN"],
  "tiempo-extra": ["REGIMEN"],
  "junta-directiva": ["REGIMEN"],
  dietas: ["REGIMEN"],
  sesiones: ["REGIMEN"],
  "descuentos-judiciales": ["REGIMEN"],
  "prestamos-regimen": ["REGIMEN"],
  "nomina-tiempo-extra": ["REGIMEN"],
  prestaciones: ["REGIMEN"],
  "otros-descuentos": ["REGIMEN"],
  "generacion-planilla": ["REGIMEN"],
  "planillas-trabajadores": ["REGIMEN"],

  jubilados: ["JUBILADOS"],
  beneficiarios: ["JUBILADOS"],
  amparistas: ["JUBILADOS"],
  convenios: ["JUBILADOS"],
  "planillas-pensionados": ["JUBILADOS"],
  nominas: ["JUBILADOS"],
  "prestaciones-jubilados": ["JUBILADOS"],
  "prestamos-jubilados": ["JUBILADOS"],
  "jubilados-reportes": ["JUBILADOS", "REPORTES"],

  // Compartidos por Régimen y Jubilados
  "datos-planilla": ["REGIMEN", "JUBILADOS"],
  nomina: ["REGIMEN", "JUBILADOS"],

  reportes: ["REPORTES"],
  impresiones: ["REPORTES"],
  catalogos: ["CATALOGOS"]
};

const { nivelesPorPantalla, pantallasDeRuta, PANTALLAS, NEGOCIO } = require("../utils/permisosModulo");

const rolesDe = (user) => {
  const lista = Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.rol];
  return [...new Set(lista.map((r) => String(r || "").toUpperCase()).filter(Boolean))];
};

const parteDeUrl = (url) => {
  const segmentos = String(url || "").split("?")[0].split("/").filter(Boolean);
  if (segmentos[0] === "api") segmentos.shift();
  return segmentos;
};

// Niveles ("ADMIN" | "OPERADOR" | "CONSULTA") que el usuario tiene para esta petición.
const nivelesEfectivos = (user, url, method) => {
  const roles = rolesDe(user);
  const niveles = new Set();
  const segmentos = parteDeUrl(url);
  const modulos = MODULOS_URL[segmentos[0]] || [];
  const lectura = String(method || "GET").toUpperCase() === "GET";

  if (roles.includes("ADMIN")) niveles.add("ADMIN");
  // Roles anteriores con alcance general: siguen funcionando igual.
  if (roles.includes("OPERADOR") || roles.includes("ADMINISTRACION")) niveles.add("OPERADOR");

  // Nivel por ventana (matriz de Roles y permisos; los permisos de módulo y los roles
  // anteriores valen para todas las ventanas de su módulo).
  const nv = nivelesPorPantalla(roles);
  const pantallas = pantallasDeRuta(segmentos.join("/"));
  const familiasRuta = new Set([...modulos, ...pantallas.flatMap((p) => p.familias)]);
  const propio = Math.max(0, ...pantallas.map((p) => nv[p.clave]));
  const agregar = (...l) => l.forEach((x) => niveles.add(x));

  if (!lectura) {
    // Escribir: solo en la ventana dueña de la ruta.
    if (propio >= 3) agregar("ADMIN", "OPERADOR", "CONSULTA");
    else if (propio === 2) agregar("OPERADOR", "CONSULTA");
    else if (propio === 1) agregar("CONSULTA");
  } else {
    // Leer: su ventana, o cualquier ventana del mismo módulo (listas que usan sus pantallas).
    const familiasUsuario = new Set();
    PANTALLAS.forEach((p) => {
      if (nv[p.clave] > 0) [...p.familias, ...(p.leeTambien || [])].forEach((f) => familiasUsuario.add(f));
    });
    if (propio >= 3) agregar("ADMIN");
    if (propio > 0 || [...familiasRuta].some((f) => familiasUsuario.has(f))) agregar("OPERADOR", "CONSULTA");
    // Quien trabaja un módulo de negocio también consulta e imprime reportes.
    if (familiasRuta.has("REPORTES") && NEGOCIO.some((f) => familiasUsuario.has(f))) agregar("OPERADOR", "CONSULTA");
    // Los catálogos los leen todos los que tengan algún permiso (listas desplegables).
    if (familiasRuta.has("CATALOGOS") && familiasUsuario.size) agregar("OPERADOR");
  }

  return niveles;
};

const authorizeRoles = (...rolesPermitidos) => (req, res, next) => {
  const allowed = rolesPermitidos.map((role) => String(role).toUpperCase());
  const niveles = nivelesEfectivos(req.user, req.originalUrl, req.method);

  if (allowed.some((nivel) => niveles.has(nivel))) {
    return next();
  }

  logger.warn("Accion denegada por permisos", {
    usuario: req.user?.usuario,
    rol: req.user?.rol,
    roles: rolesDe(req.user),
    method: req.method,
    url: req.originalUrl
  });

  auditFromRequest(req, {
    modulo: "SEGURIDAD",
    accion: "ACCESO_DENEGADO",
    descripcion: `Roles ${rolesDe(req.user).join(", ") || "SIN_ROL"} no autorizados. Permitidos: ${allowed.join(", ")}`
  });

  return res.status(403).json({
    ok: false,
    message: "No tiene permisos para realizar esta accion"
  });
};

module.exports = { authorizeRoles, nivelesEfectivos };
