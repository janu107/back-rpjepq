const successResponse = (res, data = null, message = "Operación realizada correctamente", status = 200) => {
  return res.status(status).json({
    ok: true,
    message,
    data
  });
};

const errorResponse = (res, message = "Error interno del servidor", status = 500, errors = null) => {
  return res.status(status).json({
    ok: false,
    message,
    errors
  });
};

module.exports = {
  successResponse,
  errorResponse
};
