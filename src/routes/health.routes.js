const { Router } = require("express");
const { databaseHealthCheck, healthCheck } = require("../controllers/health.controller");

const router = Router();

router.get("/", healthCheck);
router.get("/db", databaseHealthCheck);

module.exports = router;
