const { Router } = require("express");

const rolesController = require("../controllers/roles.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();

router.use(authMiddleware);

router.get("/", rolesController.listRoles);
router.get("/tipos", rolesController.listRoleTypes);
router.put("/usuario/:id", rolesController.updateUserRole);

module.exports = router;
