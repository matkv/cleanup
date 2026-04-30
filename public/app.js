import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  EditorState,
  defaultKeymap, history, historyKeymap,
  syntaxHighlighting, defaultHighlightStyle,
  markdown,
  oneDark,
} from "./vendor.js";

// ── State ────────────────────────────────────────────────────────────
let oldEditor, newEditor;
let currentFile = null;
let allFiles = [];
let existingFilePath = null; // set when user loads an existing new-vault file
let newVaultFiles = [];

// ── DOM refs ─────────────────────────────────────────────────────────
const configScreen = document.getElementById("config-screen");
const appScreen = document.getElementById("app-screen");
const cfgOld = document.getElementById("cfg-old");
const cfgNew = document.getElementById("cfg-new");
const cfgTemplates = document.getElementById("cfg-templates");
const cfgError = document.getElementById("cfg-error");
const cfgSave = document.getElementById("cfg-save");
const btnSettings = document.getElementById("btn-settings");
const oldPathEl = document.getElementById("old-path");
const templateSelect = document.getElementById("template-select");
const newSubfolder = document.getElementById("new-subfolder");
const newFilename = document.getElementById("new-filename");
const btnSave = document.getElementById("btn-save");
const btnSkip = document.getElementById("btn-skip");
const btnIgnore = document.getElementById("btn-ignore");
const btnDelete = document.getElementById("btn-delete");
const progressSummary = document.getElementById("progress-summary");
const progressBar = document.getElementById("progress-bar");
const progressDetail = document.getElementById("progress-detail");
const toast = document.getElementById("toast");
const btnLoadExisting = document.getElementById("btn-load-existing");
const existingFileDialog = document.getElementById("existing-file-dialog");
const existingFilter = document.getElementById("existing-filter");
const existingFileList = document.getElementById("existing-file-list");
const existingFileIndicator = document.getElementById("existing-file-indicator");
const existingFileLabel = document.getElementById("existing-file-label");
const btnClearExisting = document.getElementById("btn-clear-existing");

// ── CodeMirror helpers ────────────────────────────────────────────────
function makeEditor(parent, readOnly, content = "") {
  const extensions = [
    markdown(),
    oneDark,
    syntaxHighlighting(defaultHighlightStyle),
    lineNumbers(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
  ];
  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  } else {
    extensions.push(highlightActiveLine());
    extensions.push(EditorView.lineWrapping);
  }

  return new EditorView({
    state: EditorState.create({ doc: content, extensions }),
    parent,
  });
}

function setEditorContent(editor, content) {
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: content },
  });
}

function getEditorContent(editor) {
  return editor.state.doc.toString();
}

// ── Toast ─────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = "ok", duration = 2500) {
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), duration);
}

// ── API helpers ───────────────────────────────────────────────────────
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ── Progress ──────────────────────────────────────────────────────────
async function refreshProgress() {
  const result = await api("GET", "/api/files");
  allFiles = Array.isArray(result) ? result : [];
  const total = allFiles.length;
  const done = allFiles.filter((f) => f.status === "done").length;
  const skipped = allFiles.filter((f) => f.status === "skipped").length;
  const ignored = allFiles.filter((f) => f.status === "ignored").length;
  const left = total - done - skipped - ignored;
  progressSummary.textContent = `${done} / ${total} done`;
  progressBar.style.width = total ? `${(done / total) * 100}%` : "0%";
  progressDetail.textContent = `${done} done · ${skipped} skipped · ${left} left`;
}

// ── Templates ─────────────────────────────────────────────────────────
async function loadTemplates() {
  const templates = await api("GET", "/api/templates");
  templateSelect.innerHTML = '<option value="">— select type —</option>';
  if (!Array.isArray(templates)) {
    throw new Error("Templates endpoint returned: " + JSON.stringify(templates));
  }
  templates.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = t.filename;
    opt.textContent = `[${i + 1}] ${t.name}`;
    templateSelect.appendChild(opt);
  });
}

templateSelect.addEventListener("change", async () => {
  const filename = templateSelect.value;
  if (!filename) return;
  clearExistingFile();
  const content = await api("GET", `/api/template?name=${encodeURIComponent(filename)}`);
  setEditorContent(newEditor, content);
});

// ── Existing file picker ──────────────────────────────────────────────
function setExistingFile(relPath) {
  existingFilePath = relPath;
  existingFileLabel.textContent = relPath;
  existingFileIndicator.classList.remove("hidden");
  templateSelect.value = "";
}

function clearExistingFile() {
  existingFilePath = null;
  existingFileIndicator.classList.add("hidden");
  existingFileLabel.textContent = "";
}

function renderFileList(filter = "") {
  const lower = filter.toLowerCase();
  const matches = filter ? newVaultFiles.filter((f) => f.toLowerCase().includes(lower)) : newVaultFiles;
  existingFileList.innerHTML = "";
  matches.slice(0, 200).forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f;
    li.addEventListener("click", async () => {
      existingFileDialog.close();
      const content = await api("GET", `/api/newvault/file?path=${encodeURIComponent(f)}`);
      setEditorContent(newEditor, content);
      setExistingFile(f);
    });
    existingFileList.appendChild(li);
  });
}

btnLoadExisting.addEventListener("click", async () => {
  newVaultFiles = await api("GET", "/api/newvault/files");
  if (!Array.isArray(newVaultFiles)) newVaultFiles = [];
  existingFilter.value = "";
  renderFileList();
  existingFileDialog.showModal();
  existingFilter.focus();
});

existingFilter.addEventListener("input", () => renderFileList(existingFilter.value));

document.getElementById("dialog-close").addEventListener("click", () => existingFileDialog.close());
existingFileDialog.addEventListener("click", (e) => { if (e.target === existingFileDialog) existingFileDialog.close(); });

btnClearExisting.addEventListener("click", () => {
  clearExistingFile();
  setEditorContent(newEditor, "");
});

// ── Load next file ────────────────────────────────────────────────────
async function loadNext() {
  const next = await api("GET", "/api/files/next");
  if (!next) {
    currentFile = null;
    oldPathEl.textContent = "All done!";
    setEditorContent(oldEditor, "");
    setEditorContent(newEditor, "");
    newFilename.value = "";
    templateSelect.value = "";
    showToast("All files handled!", "ok", 5000);
    await refreshProgress();
    return;
  }
  currentFile = next.path;
  oldPathEl.textContent = next.path;

  const content = await api("GET", `/api/file?path=${encodeURIComponent(next.path)}`);
  setEditorContent(oldEditor, content);

  // Reset right side
  setEditorContent(newEditor, "");
  templateSelect.value = "";
  newSubfolder.value = "";
  newFilename.value = next.path.split("/").pop();
  clearExistingFile();

  await refreshProgress();
}

// ── Save ──────────────────────────────────────────────────────────────
async function save() {
  if (!currentFile) return;
  const filename = newFilename.value.trim();
  if (!existingFilePath && !filename) { showToast("Enter a filename", "warn"); return; }
  const content = getEditorContent(newEditor);
  if (!content.trim()) { showToast("New file is empty", "warn"); return; }

  const body = existingFilePath
    ? { oldPath: currentFile, existingPath: existingFilePath, content }
    : { oldPath: currentFile, newFilename: filename, newSubfolder: newSubfolder.value.trim(), content };

  const result = await api("POST", "/api/save", body);

  if (result.existed) showToast(`Overwrote existing file: ${filename}`, "warn");
  else showToast("Saved!", "ok");

  await loadNext();
}

// ── Skip / Ignore ─────────────────────────────────────────────────────
async function setStatus(status) {
  if (!currentFile) return;
  await api("POST", "/api/status", { path: currentFile, status });
  await loadNext();
}

// ── Delete old file ───────────────────────────────────────────────────
async function deleteOldFile() {
  if (!currentFile) return;
  await api("POST", "/api/delete", { path: currentFile });
  await loadNext();
}

// ── Config screen ─────────────────────────────────────────────────────
cfgSave.addEventListener("click", async () => {
  cfgError.classList.add("hidden");
  const result = await api("POST", "/api/config", {
    oldVaultPath: cfgOld.value.trim(),
    newVaultPath: cfgNew.value.trim(),
    templatesPath: cfgTemplates.value.trim(),
  });
  if (result && result.errors) {
    cfgError.textContent = result.errors.join("\n");
    cfgError.classList.remove("hidden");
    return;
  }
  await startApp();
});

btnSettings.addEventListener("click", async () => {
  const cfg = await api("GET", "/api/config");
  if (cfg) {
    cfgOld.value = cfg.oldVaultPath;
    cfgNew.value = cfg.newVaultPath;
    cfgTemplates.value = cfg.templatesPath;
  }
  appScreen.classList.add("hidden");
  configScreen.classList.remove("hidden");
});

// ── Buttons ───────────────────────────────────────────────────────────
btnSave.addEventListener("click", save);
btnSkip.addEventListener("click", () => setStatus("skipped"));
btnIgnore.addEventListener("click", () => setStatus("ignored"));
btnDelete.addEventListener("click", deleteOldFile);

// ── Keyboard shortcuts ────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (appScreen.classList.contains("hidden")) return;

  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === "ArrowRight") { e.preventDefault(); setStatus("skipped"); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); setStatus("ignored"); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === "Delete") { e.preventDefault(); deleteOldFile(); return; }

  // Ctrl+1..9 to select template
  if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
    const idx = parseInt(e.key, 10) - 1;
    const opts = templateSelect.options;
    if (idx + 1 < opts.length) {
      templateSelect.selectedIndex = idx + 1;
      templateSelect.dispatchEvent(new Event("change"));
    }
    e.preventDefault();
    return;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────
async function startApp() {
  configScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");

  try {
    if (!oldEditor) oldEditor = makeEditor(document.getElementById("old-editor"), true);
    if (!newEditor) newEditor = makeEditor(document.getElementById("new-editor"), false);
  } catch (e) {
    console.error("Editor init failed:", e);
    showToast("Editor failed to initialize: " + e.message, "err", 15000);
    return;
  }

  try {
    await loadTemplates();
  } catch (e) {
    console.error("loadTemplates failed:", e);
    showToast("Templates error: " + e.message, "err", 15000);
  }

  try {
    await loadNext();
  } catch (e) {
    console.error("loadNext failed:", e);
    showToast("File load error: " + e.message, "err", 15000);
  }
}

async function init() {
  try {
    const cfg = await api("GET", "/api/config");
    if (!cfg) {
      configScreen.classList.remove("hidden");
    } else {
      await startApp();
    }
  } catch (e) {
    console.error("Init failed:", e);
    document.body.innerHTML = `<div style="color:#f38ba8;padding:2rem;font-family:monospace">Init error: ${e.message}</div>`;
  }
}

init();
