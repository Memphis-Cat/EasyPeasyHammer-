// byanca
'use strict';

const fs = require('fs');
const path = require('path');

function sanitizeName(value) {
  return String(value || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80) || 'Untitled';
}

function appSideRoot(app) {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR);
  if (app.isPackaged) return path.dirname(process.execPath);
  return __dirname;
}

function recentNames(app) {
  const names = new Map();
  const root = path.join(app.getPath('documents'), 'EasyPeasyHammer', 'Autosaves');
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return names; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const session = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'session.json'), 'utf8'));
      const name = String(session?.project?.name || path.basename(session?.project?.vmapPath || '', '.vmap')).trim();
      if (name) names.set(name.toLowerCase(), session?.project?.vmapPath || '');
    } catch {}
  }
  return names;
}

function checkName(app, requestedName) {
  const raw = String(requestedName || '').trim();
  if (!raw) return { ok: true, available: false, error: 'Enter a project name.' };
  const cleanName = sanitizeName(raw);
  const projectsRoot = path.join(appSideRoot(app), 'Projects');
  const projectFolder = path.join(projectsRoot, cleanName);
  const vmapPath = path.join(projectFolder, `${cleanName}.vmap`);
  if (fs.existsSync(projectFolder) || fs.existsSync(vmapPath)) {
    return { ok: true, available: false, cleanName, conflictPath: fs.existsSync(vmapPath) ? vmapPath : projectFolder, error: `A map named “${cleanName}” already exists.` };
  }
  const recent = recentNames(app).get(cleanName.toLowerCase());
  if (recent) return { ok: true, available: false, cleanName, conflictPath: recent, error: `A map named “${cleanName}” already exists in Recent Maps.` };
  return { ok: true, available: true, cleanName };
}

function registerProjectNameService({ ipcMain, app }) {
  if (globalThis.__ephProjectNameService) return;
  globalThis.__ephProjectNameService = true;
  ipcMain.handle('project:name-available', (_event, name) => checkName(app, name));
}

module.exports = { registerProjectNameService, checkName };
