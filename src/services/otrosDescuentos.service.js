const adminPagos = require("./adminPagos.service");
module.exports = {
  list: () => adminPagos.list("otros-descuentos"),
  getById: (id) => adminPagos.getById("otros-descuentos", id),
  create: (payload, user) => adminPagos.create("otros-descuentos", payload, user),
  update: (id, payload, user) => adminPagos.update("otros-descuentos", id, payload, user),
  remove: (id, user) => adminPagos.remove("otros-descuentos", id, user)
};
