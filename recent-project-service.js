// byanca
'use strict';

const { shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sanitizeName(value) {
  return String(value || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80) || 'Untitled';
}

function projectKey(project) {
  const source = String(project?.vmapPath || project?.name || 'Untitled').toLowerCase();
  return `${sanitizeName(project?.name || 'Untitled')}_${crypto.createHash('sha1').update(source).digest('hex').slice(0, 10)}`;
}

function safeReadJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function inside(parent, child) {
  try {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function registerRecentProjectService({ ipcMain, app }) {
  if (globalThis.__ephRecentProjectService) return;
  globalThis.__ephRecentProjectService = true;

  ipcMain.handle('project:delete-recent', async (_event, payload) => {
    try {
      const rawPath = String(payload?.vmapPath || '').trim();
      if (!rawPath) return { ok: false, error: 'Invalid VMAP path.' };
      const vmapPath = path.resolve(rawPath);
      if (path.extname(vmapPath).toLowerCase() !== '.vmap') {
        return { ok: false, error: 'Invalid VMAP path.' };
      }

      const appRoot = process.env.PORTABLE_EXECUTABLE_DIR
        ? path.resolve(process.env.PORTABLE_EXECUTABLE_DIR)
        : app.isPackaged ? path.dirname(process.execPath) : __dirname;
      const projectsRoot = path.resolve(appRoot, 'Projects');
      const projectFolder = path.resolve(path.dirname(vmapPath));
      // A managed project is a folder *inside* Projects. Never consider the
      // Projects root itself deletable, even if somebody manually placed a
      // loose VMAP directly in that folder.
      const isManagedProject = inside(projectsRoot, projectFolder);

      let target = vmapPath;
      let deletedProjectFolder = false;
      if (isManagedProject && fs.existsSync(projectFolder)) {
        target = projectFolder;
        deletedProjectFolder = true;
      }

      if (fs.existsSync(target)) await shell.trashItem(target);

      const project = {
        name: path.basename(vmapPath, path.extname(vmapPath)),
        vmapPath,
      };
      const autosaveFolder = path.join(app.getPath('documents'), 'EasyPeasyHammer', 'Autosaves', projectKey(project));
      try { fs.rmSync(autosaveFolder, { recursive: true, force: true }); } catch {}

      const sessionFile = path.join(app.getPath('userData'), 'last-session.json');
      const pointer = safeReadJson(sessionFile);
      if (pointer?.project?.vmapPath && path.resolve(pointer.project.vmapPath).toLowerCase() === vmapPath.toLowerCase()) {
        try { fs.rmSync(sessionFile, { force: true }); } catch {}
      }

      return {
        ok: true,
        trashed: true,
        deletedProjectFolder,
        target,
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

module.exports = { registerRecentProjectService };
