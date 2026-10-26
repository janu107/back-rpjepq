const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const routes = require("./routes");
const { notFoundHandler, errorHandler } = require("./middlewares/error.middleware");

const app = express();
app.set("trust proxy", 1);
/*
  CORS:
  Aquí se colocan los dominios permitidos para consumir la API desde el navegador.
  Se agregan localhost para desarrollo y los dominios reales del servidor.
*/

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:3000",

  "https://apps-itechs.com",
  "https://www.apps-itechs.com",

  "http://apps-itechs.com",
  "http://www.apps-itechs.com"
];

const envAllowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((url) => url.trim()).filter(Boolean)
  : [];

const allowedOrigins = [
  ...defaultAllowedOrigins,
  ...envAllowedOrigins
];

app.use(helmet());

app.use(cors({
  origin(origin, callback) {
    // Permite solicitudes sin origin, por ejemplo curl, Postman o llamadas internas del servidor
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(morgan("dev"));

app.use("/api", routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
