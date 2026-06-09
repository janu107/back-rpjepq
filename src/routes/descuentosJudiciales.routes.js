const { Router } = require("express");

const controller = require("../controllers/descuentosJudiciales.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);
router.get("/", authorizeRoles("ADMIN", "OPERADOR"), controller.list);
router.get("/:id", authorizeRoles("ADMIN", "OPERADOR"), controller.getById);
router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction("DESCUENTOS_JUDICIALES", "CREAR", "Creacion de descuento judicial"), controller.create);
router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("DESCUENTOS_JUDICIALES", "EDITAR", (req) => `Edicion descuento judicial ${req.params.id}`), controller.update);
router.delete("/:id", authorizeRoles("ADMIN"), auditAction("DESCUENTOS_JUDICIALES", "ELIMINAR", (req) => `Eliminacion descuento judicial ${req.params.id}`), controller.remove);

module.exports = router;
