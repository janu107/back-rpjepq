// ============================================================================
// Reglas de estado de planilla (CAMBIO X) — fuente única de verdad en backend.
// Estados: ABIERTA, GENERADA, REVERSADA, CERRADA.
//
//   ABIERTA   -> generar     -> GENERADA
//   GENERADA  -> cerrar      -> CERRADA
//   GENERADA  -> reversar    -> REVERSADA
//   REVERSADA -> generar     -> GENERADA   (volver a generar)
//   CERRADA   -> (solo consulta / reportes)
//
// El frontend tiene una copia equivalente en src/utils/planillaEstado.js.
// ============================================================================

const ESTADOS = Object.freeze({
  ABIERTA: "ABIERTA",
  GENERADA: "GENERADA",
  REVERSADA: "REVERSADA",
  CERRADA: "CERRADA"
});

// Capacidades por estado. Cada acción es una función (estado) => boolean.
const CAPS = {
  // Se puede generar nómina cuando está ABIERTA o cuando fue REVERSADA
  // (volver a generar). Nunca cuando ya está GENERADA o CERRADA.
  generar: (e) => e === ESTADOS.ABIERTA || e === ESTADOS.REVERSADA,
  // Reversar planilla completa o pago individual: sólo si está GENERADA.
  // CERRADA queda bloqueada (sólo consulta).
  reversar: (e) => e === ESTADOS.GENERADA,
  // Cerrar: sólo desde GENERADA.
  cerrar: (e) => e === ESTADOS.GENERADA,
  // Editar montos: mientras NO esté cerrada. Los montos sólo existen cuando la
  // planilla está GENERADA, así que ese es el único estado editable real.
  editarMontos: (e) => e === ESTADOS.GENERADA,
  // Editar datos base (fechas, porcentaje): sólo en ABIERTA (antes de generar).
  editarBase: (e) => e === ESTADOS.ABIERTA
};

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const can = (action, estado) => Boolean(CAPS[action] && CAPS[action](estado));

// Lanza error de negocio (status correcto) cuando la acción no está permitida.
// Mensajes claros, sin SQL crudo (requisito CAMBIO X).
const assertCan = (action, estado) => {
  if (can(action, estado)) return;
  if (estado === ESTADOS.CERRADA) {
    throw createError("LA PLANILLA ESTÁ CERRADA Y SOLO PUEDE CONSULTARSE.", 409);
  }
  const mensajes = {
    generar: "SOLO SE PUEDE GENERAR UNA PLANILLA ABIERTA O REVERSADA.",
    reversar: "SOLO SE PUEDE REVERSAR UNA PLANILLA GENERADA.",
    cerrar: "SOLO SE PUEDE CERRAR UNA PLANILLA GENERADA.",
    editarMontos: "SOLO SE PUEDEN EDITAR LOS MONTOS DE UNA PLANILLA GENERADA.",
    editarBase: "SOLO SE PUEDEN EDITAR LOS DATOS DE UNA PLANILLA ABIERTA."
  };
  throw createError(mensajes[action] || "ACCIÓN NO PERMITIDA PARA EL ESTADO ACTUAL.", 409);
};

module.exports = { ESTADOS, CAPS, can, assertCan, createError };
