const rateLimit = require("express-rate-limit");

const loginRateLimit = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 15) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_LOGIN || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: "Demasiados intentos de inicio de sesion. Intente mas tarde."
  }
});

module.exports = { loginRateLimit };
