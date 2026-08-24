const fs = require("fs");
const path = require("path");
const multer = require("multer");
const router = require("express").Router();
const verify = require("./verifyToken");
const {
  BACKUP_ROOT,
  getArchivePath,
  getJob,
  listArchives,
  restoreFullBackup,
  startCreateJob,
} = require("../services/fullBackup");

const upload = multer({
  dest: path.join(BACKUP_ROOT, "tmp/uploads"),
  limits: { fileSize: 20 * 1024 * 1024 * 1024 },
});
fs.mkdirSync(path.join(BACKUP_ROOT, "tmp/uploads"), { recursive: true });

const adminOnly = (req, res, next) => {
  if (req.user?.role !== "FULL_ACCESS") {
    return res.status(403).json({ success: false, message: "Administrator access required." });
  }
  next();
};

router.get("/", verify, adminOnly, async (req, res) => {
  return res.json({ success: true, archives: await listArchives() });
});

router.post("/create", verify, adminOnly, async (req, res) => {
  try {
    const job = await startCreateJob("manual");
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return res.status(409).json({ success: false, message: error.message });
  }
});

router.get("/jobs/:id", verify, adminOnly, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Backup job not found." });
  return res.json({ success: true, job });
});

router.get("/download/:name", verify, adminOnly, (req, res) => {
  const archivePath = getArchivePath(req.params.name);
  if (!archivePath || !fs.existsSync(archivePath)) return res.status(404).json({ success: false, message: "Backup archive not found." });
  return res.download(archivePath, req.params.name);
});

router.post("/restore", verify, adminOnly, upload.single("backup"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Choose a full backup archive first." });
  if (!req.file.originalname.endsWith(".tar.gz")) {
    await fs.promises.rm(req.file.path, { force: true });
    return res.status(400).json({ success: false, message: "Full backups must be .tar.gz archives." });
  }
  try {
    const job = await restoreFullBackup(req.file.path);
    return res.status(202).json({ success: true, message: "Restore started. A safety backup will be created first.", job });
  } catch (error) {
    await fs.promises.rm(req.file.path, { force: true });
    return res.status(409).json({ success: false, message: error.message });
  }
});

module.exports = router;
