const mantenimientos = require("./mantenimientos.service");

module.exports = {
  list: () => mantenimientos.list("empleados"),
  getById: (id) => mantenimientos.getById("empleados", id),
  create: (payload, user) => mantenimientos.create("empleados", payload, user),
  update: (id, payload, user) => mantenimientos.update("empleados", id, payload, user),
  remove: (id, user) => mantenimientos.remove("empleados", id, user)
};
