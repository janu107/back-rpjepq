/**
 * Utilidades de normalizacion de texto.
 *
 * Regla de negocio (Version IV): los catalogos y mantenimientos deben
 * almacenarse y mostrarse en MAYUSCULAS. Esta normalizacion es la validacion
 * definitiva del backend; el frontend tambien convierte por experiencia de
 * usuario, pero aqui se garantiza el dato final.
 *
 * NUNCA se deben convertir correos, contrasenas, tokens, fechas, numeros ni
 * identificadores tecnicos: por eso la conversion es selectiva por campo.
 */

const toUpper = (value) => {
  if (typeof value !== "string") return value;
  return value.toUpperCase();
};

/**
 * Devuelve una copia del objeto con los campos indicados en MAYUSCULAS.
 * Solo afecta valores de tipo string; el resto se conserva intacto.
 *
 * @param {object} data    objeto original (no se muta)
 * @param {string[]} fields lista de claves de texto a convertir
 */
const upperCaseFields = (data, fields = []) => {
  if (!data || typeof data !== "object") return data;
  const clone = { ...data };
  fields.forEach((field) => {
    if (typeof clone[field] === "string") {
      clone[field] = clone[field].toUpperCase();
    }
  });
  return clone;
};

module.exports = { toUpper, upperCaseFields };
