const { Router } = require("express");

const usuariosController = require("../controllers/usuarios.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();

router.use(authMiddleware);

router.get("/", usuariosController.listUsers);
router.get("/:id", usuariosController.getUserById);
router.post("/", usuariosController.createUser);
router.put("/:id", usuariosController.updateUser);
router.patch("/:id/estado", usuariosController.changeStatus);
router.patch("/:id/password", usuariosController.changePassword);

module.exports = router;
