const mantenimientos = require("./mantenimientos.service");

module.exports = {
  list: () => mantenimientos.list("junta-directiva"),
  getById: (id) => mantenimientos.getById("junta-directiva", id),
  create: (payload, user) => mantenimientos.create("junta-directiva", payload, user),
  update: (id, payload, user) => mantenimientos.update("junta-directiva", id, payload, user),
  remove: (id, user) => mantenimientos.remove("junta-directiva", id, user)
};
