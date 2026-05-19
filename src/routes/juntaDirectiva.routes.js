const { Router } = require("express");

const controller = require("../controllers/juntaDirectiva.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();
router.use(authMiddleware);
router.get("/", authorizeRoles("ADMIN", "OPERADOR"), controller.list);
router.get("/:id", authorizeRoles("ADMIN", "OPERADOR"), controller.getById);
router.post("/", authorizeRoles("ADMIN", "OPERADOR"), auditAction("JUNTA_DIRECTIVA", "CREAR", "Creacion de junta directiva"), controller.create);
router.put("/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("JUNTA_DIRECTIVA", "EDITAR", (req) => `Edicion junta directiva ${req.params.id}`), controller.update);
router.delete("/:id", authorizeRoles("ADMIN"), auditAction("JUNTA_DIRECTIVA", "ELIMINAR", (req) => `Eliminacion junta directiva ${req.params.id}`), controller.remove);

module.exports = router;
