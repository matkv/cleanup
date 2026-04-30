const express = require("express");
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const advancedFormat = require("dayjs/plugin/advancedFormat");

dayjs.extend(customParseFormat);
dayjs.extend(advancedFormat);

const app = express();
app.use(express.json());
app.use(express.static("public"));

const CONFIG_PATH = path.join(__dirname, "config.json");
const PROGRESS_PATH = path.join(__dirname, "progress.json");

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function readProgress() {
  if (!fs.existsSync(PROGRESS_PATH)) return {};
  return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
}

function writeProgress(prog) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(prog, null, 2));
}

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

function getAllFiles(dir, base = dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath, base));
    } else if (entry.name.endsWith(".md")) {
      const rel = normalizePath(path.relative(base, fullPath));
      results.push(rel);
    }
  }
  return results;
}

function substituteDates(content) {
  const today = dayjs();
  content = content.replace(/\{\{date:\s*([^}]+)\}\}/g, (_, fmt) => {
    const dayjsFmt = fmt
      .trim()
      .replace(/dddd/g, "dddd")
      .replace(/DD/g, "DD")
      .replace(/MMMM/g, "MMMM")
      .replace(/YYYY/g, "YYYY");
    return today.format(dayjsFmt);
  });
  content = content.replace(/\{\{date\}\}/g, today.format("YYYY-MM-DD"));
  return content;
}

// GET /api/config
app.get("/api/config", (req, res) => {
  res.json(readConfig());
});

// POST /api/config
app.post("/api/config", (req, res) => {
  const { oldVaultPath, newVaultPath, templatesPath } = req.body;
  const errors = [];
  for (const [key, val] of Object.entries({ oldVaultPath, newVaultPath, templatesPath })) {
    if (!val) { errors.push(`${key} is required`); continue; }
    if (!fs.existsSync(val)) errors.push(`${key} path does not exist: ${val}`);
  }
  if (errors.length) return res.status(400).json({ errors });
  writeConfig({ oldVaultPath, newVaultPath, templatesPath });
  res.json({ ok: true });
});

// GET /api/files
app.get("/api/files", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const progress = readProgress();
  const files = getAllFiles(cfg.oldVaultPath).map((p) => ({
    path: p,
    status: progress[p] ?? null,
  }));
  res.json(files);
});

// GET /api/files/next
app.get("/api/files/next", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const progress = readProgress();
  const all = getAllFiles(cfg.oldVaultPath);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const unhandled = all.filter((p) => !progress[p]);
  if (unhandled.length) return res.json({ path: pick(unhandled) });
  const skipped = all.filter((p) => progress[p] === "skipped");
  if (skipped.length) return res.json({ path: pick(skipped) });
  res.json(null);
});

// GET /api/file?path=relative/path.md
app.get("/api/file", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const rel = req.query.path;
  if (!rel) return res.status(400).json({ error: "path required" });
  const abs = path.join(cfg.oldVaultPath, rel);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "file not found" });
  res.send(fs.readFileSync(abs, "utf-8"));
});

// GET /api/templates
app.get("/api/templates", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const files = fs.readdirSync(cfg.templatesPath).filter((f) => f.endsWith(".md"));
  res.json(
    files.map((f) => ({
      name: f.replace(/\.md$/, ""),
      filename: f,
    }))
  );
});

// GET /api/template?name=Journal Template.md
app.get("/api/template", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const filename = req.query.name;
  if (!filename) return res.status(400).json({ error: "name required" });
  const abs = path.join(cfg.templatesPath, filename);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "template not found" });
  const raw = fs.readFileSync(abs, "utf-8");
  res.send(substituteDates(raw));
});

// GET /api/newvault/files
app.get("/api/newvault/files", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const oldNorm = normalizePath(cfg.oldVaultPath);
  const files = getAllFiles(cfg.newVaultPath).filter((rel) => {
    const absNorm = normalizePath(path.join(cfg.newVaultPath, rel));
    return !absNorm.startsWith(oldNorm + "/") && absNorm !== oldNorm;
  });
  res.json(files);
});

// GET /api/newvault/file?path=relative/path.md
app.get("/api/newvault/file", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const rel = req.query.path;
  if (!rel) return res.status(400).json({ error: "path required" });
  const abs = path.join(cfg.newVaultPath, rel);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "file not found" });
  res.send(fs.readFileSync(abs, "utf-8"));
});

// POST /api/save
app.post("/api/save", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const { oldPath, newFilename, newSubfolder, existingPath, content } = req.body;
  if (!oldPath || content === undefined)
    return res.status(400).json({ error: "oldPath and content required" });

  let destFile;
  if (existingPath) {
    destFile = path.join(cfg.newVaultPath, existingPath);
  } else {
    if (!newFilename) return res.status(400).json({ error: "newFilename required" });
    const destDir = newSubfolder
      ? path.join(cfg.newVaultPath, newSubfolder)
      : cfg.newVaultPath;
    fs.mkdirSync(destDir, { recursive: true });
    destFile = path.join(destDir, newFilename);
  }

  const existed = fs.existsSync(destFile);
  fs.writeFileSync(destFile, content, "utf-8");

  const oldAbs = path.join(cfg.oldVaultPath, oldPath);
  fs.unlinkSync(oldAbs);

  const progress = readProgress();
  progress[normalizePath(oldPath)] = "done";
  writeProgress(progress);

  res.json({ ok: true, existed });
});

// POST /api/delete
app.post("/api/delete", (req, res) => {
  const cfg = readConfig();
  if (!cfg) return res.status(400).json({ error: "not configured" });
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: "path required" });
  const abs = path.join(cfg.oldVaultPath, filePath);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  const progress = readProgress();
  progress[normalizePath(filePath)] = "done";
  writeProgress(progress);
  res.json({ ok: true });
});

// POST /api/status
app.post("/api/status", (req, res) => {
  const { path: filePath, status } = req.body;
  if (!filePath || !["skipped", "ignored"].includes(status))
    return res.status(400).json({ error: "path and status (skipped|ignored) required" });
  const progress = readProgress();
  progress[normalizePath(filePath)] = status;
  writeProgress(progress);
  res.json({ ok: true });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Obsidian Cleaner running at http://localhost:${PORT}`));
