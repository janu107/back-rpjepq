const base = require("./nominaBase.service");
module.exports = {
  list: () => base.list("ingresos"),
  getById: (id) => base.getById("ingresos", id),
  create: (payload, user) => base.create("ingresos", payload, user),
  update: (id, payload, user) => base.update("ingresos", id, payload, user),
  remove: (id, user) => base.remove("ingresos", id, user),
  totalByPlanilla: (idPlanilla) => base.totalByPlanilla("ingresos", idPlanilla)
};
