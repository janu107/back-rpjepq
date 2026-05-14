const { Router } = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");
const controller = require("../controllers/system.controller");

const router = Router();
router.use(authMiddleware, authorizeRoles("ADMIN"));

router.get("/status", controller.status);
router.get("/storage", controller.storage);
router.get("/logs/app", auditAction("SYSTEM", "CONSULTA_LOG_APP"), controller.appLog);
router.get("/logs/error", auditAction("SYSTEM", "CONSULTA_LOG_ERROR"), controller.errorLog);

module.exports = router;
