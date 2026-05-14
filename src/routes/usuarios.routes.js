const { Router } = require("express");

const usuariosController = require("../controllers/usuarios.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();

router.use(authMiddleware);

router.use(authorizeRoles("ADMIN"));
router.get("/", usuariosController.listUsers);
router.get("/:id", usuariosController.getUserById);
router.post("/", auditAction("USUARIOS", "CREAR", "Creacion de usuario"), usuariosController.createUser);
router.put("/:id", auditAction("USUARIOS", "EDITAR", (req) => `Edicion de usuario ${req.params.id}`), usuariosController.updateUser);
router.patch("/:id/estado", auditAction("USUARIOS", "CAMBIO_ESTADO", (req) => `Cambio de estado usuario ${req.params.id}`), usuariosController.changeStatus);
router.patch("/:id/password", auditAction("USUARIOS", "CAMBIO_PASSWORD", (req) => `Cambio de password usuario ${req.params.id}`), usuariosController.changePassword);

module.exports = router;
