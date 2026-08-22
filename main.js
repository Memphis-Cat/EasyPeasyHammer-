// byanca
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let lastRendererSnapshot = null;

const APP_FOLDER = 'EasyPeasyHammer';

function getDocumentsRoot() {
  return path.join(app.getPath('documents'), APP_FOLDER);
}

function getAutosavesRoot() {
  return path.join(getDocumentsRoot(), 'Autosaves');
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

function getAutosaveFolderForProject(project) {
  const fileName = sanitizeName(project?.name || path.basename(project?.vmapPath || 'Untitled', '.vmap'));
  return path.join(getAutosavesRoot(), fileName);
}

function saveSession(project, uiState = null) {
  if (!project) return;

  const autosaveFolder = getAutosaveFolderForProject(project);
  ensureFolder(autosaveFolder);

  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    project,
    uiState: uiState || null
  };

  safeWriteJson(path.join(autosaveFolder, 'session.json'), payload);
  safeWriteJson(getSessionFile(), {
    version: 1,
    savedAt: payload.savedAt,
    project,
    autosaveFile: path.join(autosaveFolder, 'session.json')
  });
}

function getStartupState() {
  const pointer = safeReadJson(getSessionFile());
  if (!pointer?.project) {
    return { hasLastSession: false, lastSession: null };
  }

  const autosave = pointer.autosaveFile ? safeReadJson(pointer.autosaveFile) : null;
  const project = autosave?.project || pointer.project;

  return {
    hasLastSession: Boolean(project),
    lastSession: project ? {
      project,
      uiState: autosave?.uiState || null,
      savedAt: autosave?.savedAt || pointer.savedAt || null
    } : null
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

  const vmapPath = result.filePaths[0];
  const project = {
    id: `vmap:${vmapPath}`,
    type: 'existing-vmap',
    name: path.basename(vmapPath, path.extname(vmapPath)),
    vmapPath,
    projectFolder: path.dirname(vmapPath),
    createdAt: null,
    openedAt: new Date().toISOString()
  };

  saveSession(project, null);
  return project;
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
  if (!fs.existsSync(vmapPath)) {
    fs.writeFileSync(vmapPath, '// byanca\n', 'utf8');
  }

  const project = {
    id: `project:${vmapPath}`,
    type: 'new-project',
    name: cleanName,
    vmapPath,
    projectFolder,
    createdAt: new Date().toISOString(),
    openedAt: new Date().toISOString()
  };

  saveSession(project, null);
  return project;
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
    if (lastRendererSnapshot?.project) {
      saveSession(lastRendererSnapshot.project, lastRendererSnapshot.uiState);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ensureFolder(getAutosavesRoot());
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
