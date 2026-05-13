const base = require("./nominaBase.service");
module.exports = {
  list: () => base.list("descuentos"),
  getById: (id) => base.getById("descuentos", id),
  create: (payload, user) => base.create("descuentos", payload, user),
  update: (id, payload, user) => base.update("descuentos", id, payload, user),
  remove: (id, user) => base.remove("descuentos", id, user),
  totalByPlanilla: (idPlanilla) => base.totalByPlanilla("descuentos", idPlanilla)
};
