// Convierte un monto a letras en español, en el formato que usan las planillas
// de la asociación: "CUARENTA Y NUEVE MIL SEISCIENTOS SESENTA Y SIETE QUETZALES
// CON 60/100". Los centavos van como fracción, no en letras.

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
  "VEINTE", "VEINTIUNO", "VEINTIDOS", "VEINTITRES", "VEINTICUATRO", "VEINTICINCO", "VEINTISEIS",
  "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];

const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];

const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

// 0..999
const tresDigitos = (n) => {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 30) {
      partes.push(UNIDADES[resto]);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]);
    }
  }
  return partes.join(" ");
};

// Parte entera a letras (soporta hasta cientos de millones, suficiente para nómina).
const enteroALetras = (entero) => {
  if (entero === 0) return "CERO";

  const millones = Math.floor(entero / 1000000);
  const miles = Math.floor((entero % 1000000) / 1000);
  const resto = entero % 1000;

  const partes = [];
  if (millones > 0) partes.push(millones === 1 ? "UN MILLON" : `${tresDigitos(millones)} MILLONES`);
  if (miles > 0) partes.push(miles === 1 ? "MIL" : `${tresDigitos(miles)} MIL`);
  if (resto > 0) partes.push(tresDigitos(resto));

  // "UNO" suelto al final de una cifra se dice "UN" (ej. VEINTIUN QUETZALES).
  return partes.join(" ").replace(/\bVEINTIUNO\b/g, "VEINTIUN").replace(/\bUNO$/, "UN");
};

const numeroALetras = (valor, moneda = "QUETZALES") => {
  const monto = Number(valor || 0);
  const negativo = monto < 0;
  const absoluto = Math.abs(monto);

  // Redondeo a 2 decimales antes de partir, para que 0.995 no quede como 0.99.
  const centavosTotales = Math.round(absoluto * 100);
  const entero = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;

  const letras = `${enteroALetras(entero)} ${moneda} CON ${String(centavos).padStart(2, "0")}/100`;
  return negativo ? `MENOS ${letras}` : letras;
};

module.exports = { numeroALetras };
