const { Router } = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");
const controller = require("../controllers/auditoria.controller");

const router = Router();
router.use(authMiddleware, authorizeRoles("ADMIN"));

router.get("/", controller.list);
router.get("/modulos", controller.modulos);
router.get("/acciones", controller.acciones);
router.get("/:id", controller.getById);

module.exports = router;
