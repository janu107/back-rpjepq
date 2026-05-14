const { Router } = require("express");
const authController = require("../controllers/auth.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { loginRateLimit } = require("../middlewares/rateLimit.middleware");

const router = Router();

router.post("/login", loginRateLimit, authController.login);
router.get("/me", authMiddleware, authController.me);

module.exports = router;
