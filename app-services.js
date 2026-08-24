// byanca
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { registerCollaboration } = require('./collab-network');

const REMOTE_PACKAGE_URL = 'https://raw.githubusercontent.com/Memphis-Cat/EasyPeasyHammer-/main/package.json';
const VERSION_SUCCESS_CACHE_MS = 5 * 60 * 1000;
const VERSION_FAILURE_CACHE_MS = 30 * 1000;

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(x => Number.parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map(x => Number.parseInt(x, 10) || 0);
  const count = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < count; i++) {
    const av = pa[i] || 0, bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function getJson(url, timeout = 8000, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('Too many redirects during version check.')); return; }
    let request;
    try {
      request = https.get(url, {
        headers: {
          'User-Agent': 'EasyPeasyHammer-VersionCheck',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          let next;
          try { next = new URL(response.headers.location, url); }
          catch { reject(new Error('GitHub returned an invalid redirect.')); return; }
          if (next.protocol !== 'https:') { reject(new Error('Version check refused a non-HTTPS redirect.')); return; }
          getJson(next.href, timeout, redirects + 1).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub returned HTTP ${response.statusCode}`));
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
          if (body.length > 1024 * 1024) request.destroy(new Error('Version response was too large.'));
        });
        response.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (error) { reject(new Error(`Invalid GitHub version response: ${error.message}`)); }
        });
      });
    } catch (error) {
      reject(error);
      return;
    }
    request.setTimeout(timeout, () => request.destroy(new Error('GitHub version check timed out.')));
    request.on('error', reject);
  });
}

function profileFile(app) {
  return path.join(app.getPath('userData'), '.eph-user.json');
}

function getProfile(app) {
  try {
    const file = profileFile(app);
    if (!fs.existsSync(file)) return { ok: true, profile: null };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed?.username) return { ok: true, profile: null };
    return { ok: true, profile: { username: String(parsed.username).slice(0, 32), createdAt: parsed.createdAt || null } };
  } catch (error) {
    return { ok: false, error: error.message, profile: null };
  }
}

function writeProfileAtomic(file, profile) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(profile, null, 2), 'utf8');
  try { fs.renameSync(temp, file); }
  catch {
    fs.copyFileSync(temp, file);
    fs.rmSync(temp, { force: true });
  }
  try { fs.rmSync(temp, { force: true }); } catch {}
}

function setProfile(app, username) {
  try {
    const clean = String(username || '').trim().replace(/[\x00-\x1f<>:"/\\|?*]/g, '').slice(0, 32);
    if (!clean) return { ok: false, error: 'Username cannot be empty.' };
    const file = profileFile(app);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = getProfile(app).profile;
    const profile = { username: clean, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeProfileAtomic(file, profile);
    if (process.platform === 'win32') {
      try {
        const child = spawn('attrib', ['+h', file], { detached: true, windowsHide: true, stdio: 'ignore' });
        child.unref();
      } catch {}
    }
    return { ok: true, profile };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function recentAutosaveRoot(app) {
  return path.join(app.getPath('documents'), 'EasyPeasyHammer', 'Autosaves');
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

function directRecentSessionFile(app, vmapPath) {
  const resolved = path.resolve(String(vmapPath || ''));
  const project = {
    name: path.basename(resolved, path.extname(resolved)),
    vmapPath: resolved,
  };
  return path.join(recentAutosaveRoot(app), projectKey(project), 'session.json');
}

function recentProjectSessions(app) {
  const root = recentAutosaveRoot(app);
  const sessions = [];
  try {
    if (!fs.existsSync(root)) return sessions;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sessionFile = path.join(root, entry.name, 'session.json');
      let payload;
      try { payload = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch { continue; }
      const project = payload?.project;
      if (!project?.vmapPath || !fs.existsSync(project.vmapPath)) continue;
      let diskModified = 0;
      try { diskModified = fs.statSync(project.vmapPath).mtimeMs; } catch {}
      const savedTime = Date.parse(payload.savedAt || '') || diskModified || 0;
      sessions.push({
        project,
        uiState: payload.uiState || null,
        savedAt: payload.savedAt || (diskModified ? new Date(diskModified).toISOString() : null),
        savedTime,
      });
    }
  } catch {}

  const unique = new Map();
  for (const session of sessions.sort((a, b) => b.savedTime - a.savedTime)) {
    const key = path.resolve(session.project.vmapPath).toLowerCase();
    if (!unique.has(key)) unique.set(key, session);
  }
  return [...unique.values()];
}

function listRecentProjects(app, limit = 24) {
  const max = Math.max(1, Math.min(50, Number(limit) || 24));
  return recentProjectSessions(app).slice(0, max).map(session => ({
    project: {
      ...session.project,
      openedAt: session.project.openedAt || session.savedAt || null,
    },
    savedAt: session.savedAt,
  }));
}

function stripRedundantRecentVmap(project, uiState) {
  if (!uiState || typeof uiState !== 'object') return uiState || null;
  if (typeof uiState.vmapText !== 'string' || !uiState.vmapText) return uiState;

  const ui = { ...uiState };
  try {
    if (ui.dirty === false) {
      delete ui.vmapText;
      return ui;
    }

    const disk = fs.readFileSync(project.vmapPath, 'utf8');
    if (disk === ui.vmapText) delete ui.vmapText;
  } catch {}
  return ui;
}

async function openRecentProject(app, vmapPath) {
  if (!vmapPath) return null;
  const targetPath = path.resolve(String(vmapPath));
  if (path.extname(targetPath).toLowerCase() !== '.vmap' || !fs.existsSync(targetPath)) return null;

  // Opening one recent map used to call recentProjectSessions(), synchronously
  // reading and JSON-parsing every autosave. Because session.json can contain an
  // entire VMAP snapshot, a single click could block Electron's main process for
  // seconds. Resolve the deterministic project-key folder and read only the map
  // the user actually clicked.
  const directFile = directRecentSessionFile(app, targetPath);
  let payload = null;
  try {
    const text = await fs.promises.readFile(directFile, 'utf8');
    payload = JSON.parse(text);
  } catch {}

  if (!payload?.project) {
    // Compatibility fallback for unusual old sessions whose folder key predates
    // the current deterministic naming scheme. This should be rare.
    const target = targetPath.toLowerCase();
    const session = recentProjectSessions(app).find(item => path.resolve(item.project.vmapPath).toLowerCase() === target);
    if (!session) return null;
    payload = { project: session.project, uiState: session.uiState, savedAt: session.savedAt };
  }

  const project = { ...payload.project, vmapPath: targetPath, openedAt: new Date().toISOString() };
  return {
    project,
    uiState: stripRedundantRecentVmap(project, payload.uiState || null),
    savedAt: payload.savedAt || null,
  };
}

function registerAppServices({ ipcMain, app }) {
  let versionPromise = null;
  let versionExpiresAt = 0;
  ipcMain.handle('app:version-status', async () => {
    const now = Date.now();
    if (!versionPromise || now >= versionExpiresAt) {
      versionPromise = (async () => {
        const localVersion = app.getVersion();
        try {
          const remotePackage = await getJson(`${REMOTE_PACKAGE_URL}?t=${Date.now()}`);
          const remoteVersion = String(remotePackage?.version || '');
          if (!remoteVersion) throw new Error('GitHub package.json has no version.');
          const result = {
            ok: true,
            localVersion,
            remoteVersion,
            outdated: compareVersions(localVersion, remoteVersion) < 0,
            newerThanRemote: compareVersions(localVersion, remoteVersion) > 0
          };
          versionExpiresAt = Date.now() + VERSION_SUCCESS_CACHE_MS;
          return result;
        } catch (error) {
          versionExpiresAt = Date.now() + VERSION_FAILURE_CACHE_MS;
          return { ok: false, localVersion, remoteVersion: null, outdated: false, error: error.message };
        }
      })();
    }
    return versionPromise;
  });
  ipcMain.handle('profile:get', () => getProfile(app));
  ipcMain.handle('profile:set', (event, username) => setProfile(app, username));
  ipcMain.handle('project:list-recents', (event, limit) => ({ ok: true, projects: listRecentProjects(app, limit) }));
  ipcMain.handle('project:open-recent', (event, vmapPath) => openRecentProject(app, vmapPath));
  registerCollaboration({ ipcMain, app });
}

module.exports = { registerAppServices, compareVersions };
