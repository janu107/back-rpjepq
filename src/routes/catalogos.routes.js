const { Router } = require("express");

const catalogosController = require("../controllers/catalogos.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();

router.use(authMiddleware);

router.get("/:catalogo", authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"), catalogosController.list);
router.get("/:catalogo/:id", authorizeRoles("ADMIN", "OPERADOR", "CONSULTA"), catalogosController.getById);
router.post("/:catalogo", authorizeRoles("ADMIN", "OPERADOR"), auditAction("CATALOGOS", "CREAR", (req) => `Creacion catalogo ${req.params.catalogo}`), catalogosController.create);
router.put("/:catalogo/:id", authorizeRoles("ADMIN", "OPERADOR"), auditAction("CATALOGOS", "EDITAR", (req) => `Edicion catalogo ${req.params.catalogo} ${req.params.id}`), catalogosController.update);
router.delete("/:catalogo/:id", authorizeRoles("ADMIN"), auditAction("CATALOGOS", "ELIMINAR", (req) => `Eliminacion catalogo ${req.params.catalogo} ${req.params.id}`), catalogosController.remove);

module.exports = router;
