// byanca
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REMOTE_PACKAGE_URL = 'https://raw.githubusercontent.com/Memphis-Cat/EasyPeasyHammer-/main/package.json';

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

function getJson(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'EasyPeasyHammer-VersionCheck',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return getJson(response.headers.location, timeout).then(resolve, reject);
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

function setProfile(app, username) {
  try {
    const clean = String(username || '').trim().replace(/[\x00-\x1f<>:"/\\|?*]/g, '').slice(0, 32);
    if (!clean) return { ok: false, error: 'Username cannot be empty.' };
    const file = profileFile(app);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = getProfile(app).profile;
    const profile = { username: clean, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
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

function registerAppServices({ ipcMain, app }) {
  let versionPromise = null;
  ipcMain.handle('app:version-status', async () => {
    if (!versionPromise) {
      versionPromise = (async () => {
        const localVersion = app.getVersion();
        try {
          const remotePackage = await getJson(`${REMOTE_PACKAGE_URL}?t=${Date.now()}`);
          const remoteVersion = String(remotePackage?.version || '');
          if (!remoteVersion) throw new Error('GitHub package.json has no version.');
          return {
            ok: true,
            localVersion,
            remoteVersion,
            outdated: compareVersions(localVersion, remoteVersion) < 0,
            newerThanRemote: compareVersions(localVersion, remoteVersion) > 0
          };
        } catch (error) {
          return { ok: false, localVersion, remoteVersion: null, outdated: false, error: error.message };
        }
      })();
    }
    return versionPromise;
  });
  ipcMain.handle('profile:get', () => getProfile(app));
  ipcMain.handle('profile:set', (event, username) => setProfile(app, username));
}

module.exports = { registerAppServices, compareVersions };
