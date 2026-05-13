const adminPagos = require("./adminPagos.service");
module.exports = {
  list: () => adminPagos.list("dietas"),
  getById: (id) => adminPagos.getById("dietas", id),
  create: (payload, user) => adminPagos.create("dietas", payload, user),
  update: (id, payload, user) => adminPagos.update("dietas", id, payload, user),
  remove: (id, user) => adminPagos.remove("dietas", id, user)
};
