const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const BACKUP_ROOT = path.join(__dirname, "../storage/full-backups");
const JOBS = new Map();
let activeJobId = null;

const ensureRoot = async () => {
  await fs.promises.mkdir(BACKUP_ROOT, { recursive: true });
  await fs.promises.mkdir(path.join(BACKUP_ROOT, "tmp"), { recursive: true });
};

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
  });

const assertSafeArchive = async (archivePath) => {
  const output = [];
  await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-tzf", archivePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || "Unable to inspect backup archive."));
      output.push(...stdout.split("\n").filter(Boolean));
      resolve();
    });
  });
  if (output.some((entry) => path.isAbsolute(entry) || entry.split("/").includes(".."))) {
    throw new Error("Unsafe backup archive path detected.");
  }
}

const copyIfPresent = async (source, target) => {
  if (!(await exists(source))) return;
  await fs.promises.rm(target, { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.cp(source, target, { recursive: true });
};

const exists = async (target) => {
  try { await fs.promises.access(target); return true; } catch { return false; }
};

const createFullBackup = async ({ label = "manual" } = {}) => {
  await ensureRoot();
  const jobId = crypto.randomUUID();
  const workDir = path.join(BACKUP_ROOT, "tmp", jobId);
  const archiveName = `full-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
  const archivePath = path.join(BACKUP_ROOT, archiveName);
  const databaseArchive = path.join(workDir, "database.archive.gz");
  const job = { id: jobId, type: "create", label, status: "running", progress: "Preparing backup…", createdAt: new Date().toISOString(), archiveName: null, error: null };
  JOBS.set(jobId, job);

  (async () => {
    try {
      await fs.promises.mkdir(workDir, { recursive: true });
      job.progress = "Dumping database…";
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
      await run("mongodump", ["--uri", process.env.DATABASE_URL, `--archive=${databaseArchive}`, "--gzip"]);
      job.progress = "Packaging database and site data…";
      const publicDir = path.join(__dirname, "../public");
      const uploadsDir = path.join(__dirname, "../uploads");
      const tarArgs = ["-czf", archivePath, "-C", workDir, "database.archive.gz"];
      if (await exists(publicDir)) tarArgs.push("-C", path.join(__dirname, ".."), "public");
      if (await exists(uploadsDir)) tarArgs.push("-C", path.join(__dirname, ".."), "uploads");
      await run("tar", tarArgs);
      job.status = "completed";
      job.progress = "Backup ready for download.";
      job.archiveName = archiveName;
      await fs.promises.rm(workDir, { recursive: true, force: true });
    } catch (error) {
      job.status = "failed";
      job.progress = "Backup failed.";
      job.error = error.message;
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(archivePath, { force: true }).catch(() => {});
    } finally {
      if (activeJobId === jobId) activeJobId = null;
    }
  })();
  return job;
};

const startCreateJob = async (label = "manual") => {
  if (activeJobId) throw new Error("Another full backup or restore is already running.");
  const job = await createFullBackup({ label });
  activeJobId = job.id;
  return job;
};

const restoreFullBackup = async (archivePath) => {
  await ensureRoot();
  if (activeJobId) throw new Error("Another full backup or restore is already running.");
  const jobId = crypto.randomUUID();
  const workDir = path.join(BACKUP_ROOT, "tmp", jobId);
  const job = { id: jobId, type: "restore", status: "running", progress: "Preparing restore…", createdAt: new Date().toISOString(), archiveName: path.basename(archivePath), error: null };
  JOBS.set(jobId, job);
  activeJobId = jobId;
  (async () => {
    try {
      await assertSafeArchive(archivePath);
      await fs.promises.mkdir(workDir, { recursive: true });
      job.progress = "Creating safety backup before restore…";
      const safety = await createFullBackup({ label: "pre-restore" });
      while (safety.status === "running") await new Promise((resolve) => setTimeout(resolve, 500));
      if (safety.status !== "completed") throw new Error(`Safety backup failed: ${safety.error}`);
      job.progress = "Extracting backup archive…";
      await run("tar", ["-xzf", archivePath, "-C", workDir, "--no-same-owner"]);
      const databaseArchive = path.join(workDir, "database.archive.gz");
      if (!(await exists(databaseArchive))) throw new Error("Backup does not contain a database dump.");
      job.progress = "Restoring database…";
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
      await run("mongorestore", ["--uri", process.env.DATABASE_URL, "--archive=" + databaseArchive, "--gzip", "--drop"]);
      job.progress = "Restoring site files…";
      await copyIfPresent(path.join(workDir, "public"), path.join(__dirname, "../public"));
      await copyIfPresent(path.join(workDir, "uploads"), path.join(__dirname, "../uploads"));
      job.status = "completed";
      job.progress = "Full website restore completed.";
    } catch (error) {
      job.status = "failed";
      job.progress = "Restore failed. The pre-restore safety backup is available.";
      job.error = error.message;
    } finally {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(archivePath, { force: true }).catch(() => {});
      if (activeJobId === jobId) activeJobId = null;
    }
  })();
  return job;
};

const getJob = (id) => JOBS.get(id) || null;
const listArchives = async () => {
  await ensureRoot();
  const entries = await fs.promises.readdir(BACKUP_ROOT, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".tar.gz")).map(async (entry) => {
    const fullPath = path.join(BACKUP_ROOT, entry.name);
    const stat = await fs.promises.stat(fullPath);
    return { name: entry.name, size: stat.size, createdAt: stat.birthtime.toISOString() };
  }));
};
const getArchivePath = (name) => {
  const safe = path.basename(name);
  if (safe !== name || !safe.endsWith(".tar.gz")) return null;
  return path.join(BACKUP_ROOT, safe);
};

module.exports = { BACKUP_ROOT, getArchivePath, getJob, listArchives, restoreFullBackup, startCreateJob };
