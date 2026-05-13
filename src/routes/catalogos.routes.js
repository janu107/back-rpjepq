const { Router } = require("express");

const catalogosController = require("../controllers/catalogos.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = Router();

router.use(authMiddleware);

router.get("/:catalogo", catalogosController.list);
router.get("/:catalogo/:id", catalogosController.getById);
router.post("/:catalogo", catalogosController.create);
router.put("/:catalogo/:id", catalogosController.update);
router.delete("/:catalogo/:id", catalogosController.remove);

module.exports = router;
