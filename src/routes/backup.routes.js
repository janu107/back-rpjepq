const path = require("path");
const multer = require("multer");
const { Router } = require("express");

const authMiddleware = require("../middlewares/auth.middleware");
const { auditAction } = require("../middlewares/audit.middleware");
const { authorizeRoles } = require("../middlewares/role.middleware");
const controller = require("../controllers/backup.controller");
const backupService = require("../services/backup.service");

const router = Router();
router.use(authMiddleware, authorizeRoles("ADMIN"));

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, backupService.restoreDir);
  },
  filename(req, file, cb) {
    const safe = path.basename(file.originalname).replace(/[^\w.-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 200 },
  fileFilter(req, file, cb) {
    if (file.originalname.endsWith(".sql") || file.originalname.endsWith(".sql.gz")) return cb(null, true);
    return cb(new Error("Solo se permiten archivos .sql o .sql.gz"));
  }
});

router.get("/status", controller.status);
router.post("/generar", auditAction("BACKUP", "GENERADO", "Backup generado manualmente"), controller.generar);
router.get("/listar", controller.listar);
router.get("/historial", controller.historial);
router.get("/descargar/:nombreArchivo", auditAction("BACKUP", "DESCARGADO", (req) => `Descarga ${req.params.nombreArchivo}`), controller.descargar);
router.delete("/:nombreArchivo", auditAction("BACKUP", "ELIMINADO", (req) => `Eliminacion ${req.params.nombreArchivo}`), controller.eliminar);
router.post("/restaurar", upload.single("archivo"), auditAction("BACKUP", "RESTAURADO", "Restauracion de base de datos"), controller.restaurar);

module.exports = router;
