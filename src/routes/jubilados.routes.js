const { Router } = require("express");

const controller = require("../controllers/jubilados.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);
router.get("/", authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"), controller.list);
router.get("/:id", authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"), controller.getById);
router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction("JUBILADOS", "CREAR", "Creacion de jubilado"), controller.create);
router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("JUBILADOS", "EDITAR", (req) => `Edicion jubilado ${req.params.id}`), controller.update);
router.delete("/:id", authorizeRoles("ADMIN"), auditAction("JUBILADOS", "ELIMINAR", (req) => `Eliminacion jubilado ${req.params.id}`), controller.remove);

module.exports = router;
