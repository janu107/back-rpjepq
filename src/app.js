const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const routes = require("./routes");
const { notFoundHandler, errorHandler } = require("./middlewares/error.middleware");

const app = express();

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
