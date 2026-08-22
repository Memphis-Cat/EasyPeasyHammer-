// byanca
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let mainWindow = null;
let lastRendererSnapshot = null;

const APP_FOLDER = 'EasyPeasyHammer';

function getDocumentsRoot() {
  return path.join(app.getPath('documents'), APP_FOLDER);
}

function getAutosavesRoot() {
  return path.join(getDocumentsRoot(), 'Autosaves');
}

function getBackupsRoot() {
  return path.join(getDocumentsRoot(), 'Backups');
}

function getSessionFile() {
  return path.join(app.getPath('userData'), 'last-session.json');
}

function ensureFolder(folderPath) {
  fs.mkdirSync(folderPath, { recursive: true });
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, value) {
  ensureFolder(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

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

function getAutosaveFolderForProject(project) {
  return path.join(getAutosavesRoot(), projectKey(project));
}

function getBackupFolderForVmap(vmapPath) {
  const name = sanitizeName(path.basename(vmapPath || 'Untitled.vmap', path.extname(vmapPath || '')));
  const hash = crypto.createHash('sha1').update(String(vmapPath || '')).digest('hex').slice(0, 10);
  return path.join(getBackupsRoot(), `${name}_${hash}`);
}

function saveSession(project, uiState = null) {
  if (!project) return;
  const autosaveFolder = getAutosaveFolderForProject(project);
  ensureFolder(autosaveFolder);

  const payload = {
    version: 2,
    savedAt: new Date().toISOString(),
    project,
    uiState: uiState || null
  };

  safeWriteJson(path.join(autosaveFolder, 'session.json'), payload);
  safeWriteJson(getSessionFile(), {
    version: 2,
    savedAt: payload.savedAt,
    project,
    autosaveFile: path.join(autosaveFolder, 'session.json')
  });
}

function getProjectAutosave(project) {
  if (!project) return null;
  return safeReadJson(path.join(getAutosaveFolderForProject(project), 'session.json'));
}

function getStartupState() {
  const pointer = safeReadJson(getSessionFile());
  if (!pointer?.project) return { hasLastSession: false, lastSession: null };

  const autosave = pointer.autosaveFile ? safeReadJson(pointer.autosaveFile) : getProjectAutosave(pointer.project);
  const project = autosave?.project || pointer.project;
  if (!project) return { hasLastSession: false, lastSession: null };

  return {
    hasLastSession: true,
    lastSession: {
      project,
      uiState: autosave?.uiState || null,
      savedAt: autosave?.savedAt || pointer.savedAt || null
    }
  };
}

function projectFromPath(vmapPath, type = 'existing-vmap') {
  return {
    id: `vmap:${vmapPath}`,
    type,
    name: path.basename(vmapPath, path.extname(vmapPath)),
    vmapPath,
    projectFolder: path.dirname(vmapPath),
    createdAt: type === 'new-project' ? new Date().toISOString() : null,
    openedAt: new Date().toISOString()
  };
}

async function openExistingVmap() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open existing VMAP',
    properties: ['openFile'],
    filters: [
      { name: 'Valve Map', extensions: ['vmap'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const project = projectFromPath(result.filePaths[0]);
  saveSession(project, null);
  return { project, uiState: null };
}

async function createNewProject(event, projectName) {
  const cleanName = sanitizeName(projectName || 'Untitled');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where to create the project folder',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const projectFolder = path.join(result.filePaths[0], cleanName);
  ensureFolder(projectFolder);
  const vmapPath = path.join(projectFolder, `${cleanName}.vmap`);
  const project = projectFromPath(vmapPath, 'new-project');
  saveSession(project, null);
  return { project, uiState: null };
}

function loadVmap(vmapPath) {
  try {
    if (!vmapPath || !fs.existsSync(vmapPath)) return { ok: false, error: 'VMAP file does not exist.' };
    const stat = fs.statSync(vmapPath);
    return {
      ok: true,
      text: fs.readFileSync(vmapPath, 'utf8'),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function createBackup(vmapPath) {
  if (!fs.existsSync(vmapPath)) return null;
  const folder = getBackupFolderForVmap(vmapPath);
  ensureFolder(folder);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(folder, `${path.basename(vmapPath, '.vmap')}_${stamp}.vmap`);
  fs.copyFileSync(vmapPath, backupPath);
  return backupPath;
}

function saveVmap(vmapPath, text, makeBackup = true) {
  try {
    if (!vmapPath) return { ok: false, error: 'Missing VMAP path.' };
    if (path.extname(vmapPath).toLowerCase() !== '.vmap') return { ok: false, error: 'Only .vmap files can be written.' };
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'VMAP data is empty.' };

    ensureFolder(path.dirname(vmapPath));
    const backupPath = makeBackup ? createBackup(vmapPath) : null;
    const tempPath = `${vmapPath}.eph-tmp`;
    fs.writeFileSync(tempPath, text, 'utf8');
    fs.renameSync(tempPath, vmapPath);
    return { ok: true, backupPath, bytes: Buffer.byteLength(text, 'utf8') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0f1115',
    title: 'EasyPeasyHammer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('close', () => {
    if (lastRendererSnapshot?.project) saveSession(lastRendererSnapshot.project, lastRendererSnapshot.uiState);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  ensureFolder(getAutosavesRoot());
  ensureFolder(getBackupsRoot());
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:get-startup-state', () => getStartupState());
ipcMain.handle('project:open-vmap', () => openExistingVmap());
ipcMain.handle('project:create', createNewProject);
ipcMain.handle('project:load-vmap', (event, vmapPath) => loadVmap(vmapPath));
ipcMain.handle('project:save-vmap', (event, vmapPath, text, backup) => saveVmap(vmapPath, text, backup !== false));
ipcMain.handle('project:continue-last', () => {
  const startup = getStartupState();
  if (!startup.hasLastSession) return null;
  const project = { ...startup.lastSession.project, openedAt: new Date().toISOString() };
  saveSession(project, startup.lastSession.uiState);
  return { project, uiState: startup.lastSession.uiState || null };
});
ipcMain.handle('project:autosave', (event, snapshot) => {
  if (!snapshot?.project) return { ok: false };
  lastRendererSnapshot = snapshot;
  saveSession(snapshot.project, snapshot.uiState || null);
  return { ok: true, savedAt: new Date().toISOString() };
});
ipcMain.handle('project:return-home', (event, snapshot) => {
  if (snapshot?.project) {
    lastRendererSnapshot = snapshot;
    saveSession(snapshot.project, snapshot.uiState || null);
  }
  return getStartupState();
});
ipcMain.handle('project:reveal', async (event, projectFolder) => {
  if (!projectFolder || !fs.existsSync(projectFolder)) return false;
  await shell.openPath(projectFolder);
  return true;
});
ipcMain.handle('project:clear-last-session', () => {
  try { fs.rmSync(getSessionFile(), { force: true }); } catch {}
  lastRendererSnapshot = null;
  return true;
});
