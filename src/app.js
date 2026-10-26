const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const routes = require("./routes");
const { notFoundHandler, errorHandler } = require("./middlewares/error.middleware");

const app = express();

// Detrás de nginx, sin esto todas las peticiones llegan con la IP del proxy y el
// límite de intentos de login bloquea a todos a la vez. Por defecto se confía en
// un proxy en producción; TRUST_PROXY=0 lo desactiva si la API se expone directo.
const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === "production" ? "1" : "0");
app.set("trust proxy", Number(trustProxy) || false);

const allowedOrigins = (process.env.NODE_ENV === "production"
  ? [process.env.FRONTEND_URL || "https://apps-itechs.com"]
  : ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", process.env.FRONTEND_URL].filter(Boolean)
);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origen no permitido por CORS"));
  },
  credentials: true
}));
app.use(express.json());
app.use(morgan("dev"));

app.use("/api", routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
