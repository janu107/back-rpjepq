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
  "jubilados-reportes": ["JUBILADOS", "REPORTES"],

  // Compartidos por Régimen y Jubilados
  "datos-planilla": ["REGIMEN", "JUBILADOS"],
  nomina: ["REGIMEN", "JUBILADOS"],

  reportes: ["REPORTES"],
  impresiones: ["REPORTES"],
  catalogos: ["CATALOGOS"]
};

const MODULOS_NEGOCIO = ["EPQ", "REGIMEN", "JUBILADOS"];
const ROLES_NUEVOS = ["CATALOGOS", "EPQ", "REGIMEN", "JUBILADOS", "REPORTES", "ADMINISTRACION", "CONSULTA"];

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

  roles.forEach((rol) => {
    if (rol === "ADMIN") niveles.add("ADMIN");
    if (rol === "OPERADOR" || rol === "ADMINISTRACION") niveles.add("OPERADOR");

    if (MODULOS_NEGOCIO.includes(rol) && modulos.includes(rol)) niveles.add("OPERADOR");
    // Quien trabaja un módulo también puede consultar e imprimir sus reportes.
    if (MODULOS_NEGOCIO.includes(rol) && modulos.includes("REPORTES")) niveles.add("CONSULTA");

    if (rol === "CATALOGOS" && modulos.includes("CATALOGOS")) {
      // El catálogo de manejo/administración sólo se puede consultar.
      const esManejo = /manejo/i.test(segmentos[1] || "");
      if (lectura || !esManejo) niveles.add("OPERADOR");
    }

    if (rol === "REPORTES" && modulos.includes("REPORTES")) niveles.add("CONSULTA");

    if (rol === "CONSULTA") {
      if (lectura && modulos.some((m) => MODULOS_NEGOCIO.includes(m))) niveles.add("OPERADOR");
      if (modulos.includes("REPORTES")) niveles.add("CONSULTA");
    }
  });

  // Lectura de catálogos para cualquier usuario con un rol del listado nuevo.
  if (lectura && modulos.includes("CATALOGOS") && roles.some((r) => ROLES_NUEVOS.includes(r))) {
    niveles.add("OPERADOR");
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
