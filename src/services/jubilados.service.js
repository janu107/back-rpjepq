const mantenimientos = require("./mantenimientos.service");

module.exports = {
  list: () => mantenimientos.list("jubilados"),
  getById: (id) => mantenimientos.getById("jubilados", id),
  create: (payload, user) => mantenimientos.create("jubilados", payload, user),
  update: (id, payload, user) => mantenimientos.update("jubilados", id, payload, user),
  remove: (id, user) => mantenimientos.remove("jubilados", id, user)
};
