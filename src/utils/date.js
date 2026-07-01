// Normaliza un valor de fecha a "YYYY-MM-DD".
// mysql2 (sin dateStrings) devuelve DATE/DATETIME como objetos Date; hacer
// String(date).slice(0,10) produce "Tue Jun 30" (toString), NO la fecha ISO.
// Este helper usa las partes locales del Date (sin desfase de zona horaria) o
// recorta un string ISO. Devuelve null si no hay valor.
const toISODate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
};

module.exports = { toISODate };
