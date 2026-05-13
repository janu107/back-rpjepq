const adminPagos = require("./adminPagos.service");
module.exports = {
  list: () => adminPagos.list("tiempo-extra"),
  getById: (id) => adminPagos.getById("tiempo-extra", id),
  create: (payload, user) => adminPagos.create("tiempo-extra", payload, user),
  update: (id, payload, user) => adminPagos.update("tiempo-extra", id, payload, user),
  remove: (id, user) => adminPagos.remove("tiempo-extra", id, user)
};
