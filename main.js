// byanca
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AssetHost } = require('./asset-host');
const { registerAppServices } = require('./app-services');

let mainWindow = null;
let chatWindow = null;
let lastRendererSnapshot = null;
let assetHost = null;
const APP_FOLDER = 'EasyPeasyHammer';
const BACKUP_LIMIT = 60;

registerAppServices({ ipcMain, app });

function getDocumentsRoot() { return path.join(app.getPath('documents'), APP_FOLDER); }
function getAutosavesRoot() { return path.join(getDocumentsRoot(), 'Autosaves'); }
function getBackupsRoot() { return path.join(getDocumentsRoot(), 'Backups'); }
function getSessionFile() { return path.join(app.getPath('userData'), 'last-session.json'); }
function getAssetConfigFile() { return path.join(app.getPath('userData'), 'asset-config.json'); }
function getAppSideRoot() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR);
  if (app.isPackaged) return path.dirname(process.execPath);
  return __dirname;
}
function getProjectsRoot() { return path.join(getAppSideRoot(), 'Projects'); }
function ensureFolder(folderPath) { fs.mkdirSync(folderPath, { recursive: true }); }
function safeReadJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function safeWriteJson(filePath, value) { ensureFolder(path.dirname(filePath)); fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8'); }
function sanitizeName(value) { return String(value || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || 'Untitled'; }
function projectKey(project) { const source = String(project?.vmapPath || project?.name || 'Untitled').toLowerCase(); return `${sanitizeName(project?.name || 'Untitled')}_${crypto.createHash('sha1').update(source).digest('hex').slice(0, 10)}`; }
function getAutosaveFolderForProject(project) { return path.join(getAutosavesRoot(), projectKey(project)); }
function getBackupFolderForVmap(vmapPath) { const name = sanitizeName(path.basename(vmapPath || 'Untitled.vmap', path.extname(vmapPath || ''))); const hash = crypto.createHash('sha1').update(String(vmapPath || '')).digest('hex').slice(0, 10); return path.join(getBackupsRoot(), `${name}_${hash}`); }

function saveSession(project, uiState = null) {
  if (!project) return;
  const autosaveFolder = getAutosaveFolderForProject(project);
  ensureFolder(autosaveFolder);
  const payload = { version: 3, savedAt: new Date().toISOString(), project, uiState: uiState || null };
  safeWriteJson(path.join(autosaveFolder, 'session.json'), payload);
  safeWriteJson(getSessionFile(), { version: 3, savedAt: payload.savedAt, project, autosaveFile: path.join(autosaveFolder, 'session.json') });
}

function getProjectAutosave(project) { if (!project) return null; return safeReadJson(path.join(getAutosaveFolderForProject(project), 'session.json')); }
function getStartupState() {
  const pointer = safeReadJson(getSessionFile());
  if (!pointer?.project) return { hasLastSession: false, lastSession: null };
  const autosave = pointer.autosaveFile ? safeReadJson(pointer.autosaveFile) : getProjectAutosave(pointer.project);
  const project = autosave?.project || pointer.project;
  if (!project) return { hasLastSession: false, lastSession: null };
  return { hasLastSession: true, lastSession: { project, uiState: autosave?.uiState || null, savedAt: autosave?.savedAt || pointer.savedAt || null } };
}

function projectFromPath(vmapPath, type = 'existing-vmap') {
  return { id: `vmap:${vmapPath}`, type, name: path.basename(vmapPath, path.extname(vmapPath)), vmapPath, projectFolder: path.dirname(vmapPath), createdAt: type === 'new-project' ? new Date().toISOString() : null, openedAt: new Date().toISOString() };
}

function uiStateForDisk(vmapPath, autosave) {
  if (!autosave?.uiState) return null;
  try {
    const diskModified = fs.statSync(vmapPath).mtimeMs;
    const autosaveTime = Date.parse(autosave.savedAt || '') || 0;
    if (diskModified <= autosaveTime + 1000) return autosave.uiState;
    const ui = structuredClone(autosave.uiState);
    delete ui.vmapText;
    delete ui.objectExtras;
    return ui;
  } catch {
    return autosave.uiState;
  }
}

async function openExistingVmap() {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Open existing VMAP', properties: ['openFile'], filters: [{ name: 'Valve Map', extensions: ['vmap'] }, { name: 'All Files', extensions: ['*'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const project = projectFromPath(result.filePaths[0]);
  const autosave = getProjectAutosave(project);
  const uiState = uiStateForDisk(project.vmapPath, autosave);
  saveSession(project, uiState);
  return { project, uiState };
}

async function createNewProject(event, projectName) {
  const requestedName = sanitizeName(projectName || 'Untitled');
  try {
    const projectsRoot = getProjectsRoot();
    ensureFolder(projectsRoot);

    let cleanName = requestedName;
    let suffix = 2;
    let projectFolder = path.join(projectsRoot, cleanName);
    let vmapPath = path.join(projectFolder, `${cleanName}.vmap`);

    while (fs.existsSync(projectFolder) || fs.existsSync(vmapPath)) {
      cleanName = `${requestedName}_${suffix++}`;
      projectFolder = path.join(projectsRoot, cleanName);
      vmapPath = path.join(projectFolder, `${cleanName}.vmap`);
    }

    ensureFolder(projectFolder);
    const project = projectFromPath(vmapPath, 'new-project');
    saveSession(project, null);
    return { project, uiState: null, projectsRoot };
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Could not create project',
      message: 'EasyPeasyHammer could not create the Projects folder beside the application.',
      detail: error.message
    });
    return null;
  }
}

function loadVmap(vmapPath) {
  try {
    if (!vmapPath || !fs.existsSync(vmapPath)) return { ok: false, error: 'VMAP file does not exist.' };
    const stat = fs.statSync(vmapPath);
    return { ok: true, text: fs.readFileSync(vmapPath, 'utf8'), size: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch (error) { return { ok: false, error: error.message }; }
}

function pruneBackups(folder) {
  try {
    const files = fs.readdirSync(folder)
      .filter(name => name.toLowerCase().endsWith('.vmap'))
      .map(name => ({ path: path.join(folder, name), mtime: fs.statSync(path.join(folder, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const item of files.slice(BACKUP_LIMIT)) {
      try { fs.rmSync(item.path, { force: true }); } catch {}
    }
  } catch {}
}

function createBackup(vmapPath) {
  if (!fs.existsSync(vmapPath)) return null;
  const folder = getBackupFolderForVmap(vmapPath);
  ensureFolder(folder);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(folder, `${path.basename(vmapPath, '.vmap')}_${stamp}.vmap`);
  fs.copyFileSync(vmapPath, backupPath);
  pruneBackups(folder);
  return backupPath;
}

function saveVmap(vmapPath, text, makeBackup = true) {
  let tempPath = null;
  try {
    if (!vmapPath) return { ok: false, error: 'Missing VMAP path.' };
    if (path.extname(vmapPath).toLowerCase() !== '.vmap') return { ok: false, error: 'Only .vmap files can be written.' };
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'VMAP data is empty.' };
    ensureFolder(path.dirname(vmapPath));
    const backupPath = makeBackup ? createBackup(vmapPath) : null;
    tempPath = `${vmapPath}.eph-tmp`;
    fs.writeFileSync(tempPath, text, 'utf8');
    try {
      fs.renameSync(tempPath, vmapPath);
      tempPath = null;
    } catch (error) {
      if (!fs.existsSync(vmapPath)) throw error;
      fs.copyFileSync(tempPath, vmapPath);
      fs.rmSync(tempPath, { force: true });
      tempPath = null;
    }
    return { ok: true, backupPath, bytes: Buffer.byteLength(text, 'utf8') };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (tempPath) try { fs.rmSync(tempPath, { force: true }); } catch {}
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#090a0c',
    title: 'EasyPeasyHammer',
    autoHideMenuBar: true,
    frame: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', () => { if (lastRendererSnapshot?.project) saveSession(lastRendererSnapshot.project, lastRendererSnapshot.uiState); });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.close();
  });
}

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) return chatWindow;
  chatWindow = new BrowserWindow({
    width: 860,
    height: 700,
    minWidth: 560,
    minHeight: 480,
    backgroundColor: '#0a0b0d',
    title: 'EasyPeasyHammer - Collaborator Chat',
    autoHideMenuBar: true,
    frame: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  chatWindow.loadFile(path.join(__dirname, 'src', 'chat.html'));
  chatWindow.once('ready-to-show', () => chatWindow?.show());
  chatWindow.on('closed', () => { chatWindow = null; });
  return chatWindow;
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event?.sender) || mainWindow;
}

async function chooseCs2Folder() {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose Counter-Strike 2 installation folder', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const loaded = await assetHost.request('set-path', { path: result.filePaths[0] }, 120000);
  if (loaded?.available && loaded?.cs2Root) safeWriteJson(getAssetConfigFile(), { cs2Root: loaded.cs2Root });
  return loaded;
}

async function launchWorkshopTools() {
  const info = await assetHost.request('hammer-info', {}, 15000);
  if (!info?.ok || !info.csgocfg || !fs.existsSync(info.csgocfg)) return { ok: false, error: info?.error || 'CS2 Workshop Tools were not found.' };
  try {
    const child = spawn(info.csgocfg, [], { detached: true, stdio: 'ignore', cwd: path.dirname(info.csgocfg), windowsHide: false });
    child.unref();
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
}

app.whenReady().then(async () => {
  ensureFolder(getAutosavesRoot());
  ensureFolder(getBackupsRoot());
  const assetConfig = safeReadJson(getAssetConfigFile(), {});
  assetHost = new AssetHost({ cacheRoot: path.join(app.getPath('userData'), 'AssetCache'), cs2Path: assetConfig?.cs2Root || null });
  assetHost.start();
  createMainWindow();
  app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(); });
}).catch(async error => {
  try { await dialog.showMessageBox({ type: 'error', title: 'EasyPeasyHammer startup failed', message: error.message }); } catch {}
  app.quit();
});

app.on('window-all-closed', () => { assetHost?.stop(); if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('window:minimize', event => { windowFromEvent(event)?.minimize(); return true; });
ipcMain.handle('window:toggle-maximize', event => {
  const target = windowFromEvent(event);
  if (!target) return false;
  if (target.isMaximized()) target.unmaximize(); else target.maximize();
  return target.isMaximized();
});
ipcMain.handle('window:is-maximized', event => Boolean(windowFromEvent(event)?.isMaximized()));
ipcMain.handle('window:close', event => { windowFromEvent(event)?.close(); return true; });
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
  if (snapshot?.project) { lastRendererSnapshot = snapshot; saveSession(snapshot.project, snapshot.uiState || null); }
  return getStartupState();
});
ipcMain.handle('project:reveal', async (event, projectFolder) => { if (!projectFolder || !fs.existsSync(projectFolder)) return false; await shell.openPath(projectFolder); return true; });
ipcMain.handle('project:clear-last-session', () => { try { fs.rmSync(getSessionFile(), { force: true }); } catch {} lastRendererSnapshot = null; return true; });
ipcMain.handle('assets:status', async () => assetHost.request('status'));
ipcMain.handle('assets:detect', async () => assetHost.request('detect', {}, 120000));
ipcMain.handle('assets:choose-cs2-folder', chooseCs2Folder);
ipcMain.handle('assets:search', async (event, kind, query, limit) => assetHost.request('search', { kind, query, limit }, 30000));
ipcMain.handle('assets:material-preview', async (event, resourcePath) => assetHost.request('material-preview', { path: resourcePath }, 60000));
ipcMain.handle('assets:model-preview', async (event, resourcePath) => assetHost.request('model-preview', { path: resourcePath }, 120000));
ipcMain.handle('tools:open-workshop', launchWorkshopTools);
ipcMain.handle('collab:open-chat', () => {
  try {
    const target = createChatWindow();
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('collab:is-chat-focused', () => Boolean(chatWindow && !chatWindow.isDestroyed() && chatWindow.isFocused()));
