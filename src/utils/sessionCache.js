const crypto = require("crypto");

// Caché corta del usuario de cada sesión, para no consultar la base en cada petición.
// Un cambio de estado, roles o contraseña se aplica, como máximo, a los TTL_MS;
// desde la pantalla de Usuarios/Roles se aplica al instante con invalidar().
const TTL_MS = 30 * 1000;
const cache = new Map();

const obtener = (id) => {
  const item = cache.get(Number(id));
  if (!item) return null;
  if (item.expira < Date.now()) {
    cache.delete(Number(id));
    return null;
  }
  return item.valor;
};

const guardar = (id, valor) => {
  cache.set(Number(id), { valor, expira: Date.now() + TTL_MS });
};

const invalidar = (id) => {
  cache.delete(Number(id));
};

// Huella del hash de la contraseña que viaja en el token: si la contraseña cambia,
// la huella deja de coincidir y las sesiones anteriores quedan inválidas.
const huellaPassword = (hash) => crypto
  .createHash("sha256")
  .update(String(hash || ""))
  .digest("hex")
  .slice(0, 16);

module.exports = { obtener, guardar, invalidar, huellaPassword };
