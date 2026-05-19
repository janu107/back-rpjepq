const adminPagos = require("./adminPagos.service");
module.exports = {
  list: () => adminPagos.list("salarios"),
  getById: (id) => adminPagos.getById("salarios", id),
  create: (payload, user) => adminPagos.create("salarios", payload, user),
  bulkCreate: (payload, user) => adminPagos.bulkCreate("salarios", payload.salarios, user),
  update: (id, payload, user) => adminPagos.update("salarios", id, payload, user),
  remove: (id, user) => adminPagos.remove("salarios", id, user)
};
