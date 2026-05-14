const { Router } = require("express");

const rolesController = require("../controllers/roles.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");

const router = Router();

router.use(authMiddleware, authorizeRoles("ADMIN"));

router.get("/", rolesController.listRoles);
router.get("/tipos", rolesController.listRoleTypes);
router.put("/usuario/:id", auditAction("ROLES", "CAMBIO_ROL", (req) => `Cambio de rol usuario ${req.params.id}`), rolesController.updateUserRole);

module.exports = router;
