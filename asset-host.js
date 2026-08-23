// byanca
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

class AssetHost {
  constructor(options = {}) {
    this.cacheRoot = options.cacheRoot;
    this.cs2Path = options.cs2Path || null;
    this.process = null;
    this.buffer = '';
    this.pending = new Map();
    this.counter = 0;
    this.starting = null;
    this.lastError = null;
  }

  findLaunch() {
    const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'asset-host', 'EasyPeasyHammer.AssetHost.exe') : null;
    const localPublish = path.join(__dirname, 'backend', 'EasyPeasyHammer.AssetHost', 'bin', 'Release', 'net10.0', 'win-x64', 'publish', 'EasyPeasyHammer.AssetHost.exe');
    const localExe = path.join(__dirname, 'backend', 'EasyPeasyHammer.AssetHost', 'bin', 'Release', 'net10.0', 'EasyPeasyHammer.AssetHost.exe');
    for (const exe of [packaged, localPublish, localExe]) if (exe && fs.existsSync(exe)) return { command: exe, args: ['--cache', this.cacheRoot, ...(this.cs2Path ? ['--cs2', this.cs2Path] : [])] };

    const project = path.join(__dirname, 'backend', 'EasyPeasyHammer.AssetHost', 'EasyPeasyHammer.AssetHost.csproj');
    if (fs.existsSync(project)) {
      const probe = spawnSync('dotnet', ['--version'], { windowsHide: true, encoding: 'utf8' });
      if (probe.status === 0) return { command: 'dotnet', args: ['run', '--project', project, '-c', 'Release', '--no-launch-profile', '--', '--cache', this.cacheRoot, ...(this.cs2Path ? ['--cs2', this.cs2Path] : [])] };
    }
    return null;
  }

  async start() {
    if (this.process && !this.process.killed && this.process.exitCode == null) return true;
    if (this.starting) return this.starting;
    this.starting = new Promise(resolve => {
      const launch = this.findLaunch();
      if (!launch) {
        this.lastError = 'The Source 2 asset backend is not built. Run Build_Backend.bat or Build_EXE.bat.';
        this.starting = null;
        resolve(false);
        return;
      }

      this.buffer = '';
      this.lastError = null;
      let child;
      try {
        child = spawn(launch.command, launch.args, { cwd: __dirname, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (error) {
        this.lastError = error.message;
        this.starting = null;
        resolve(false);
        return;
      }
      this.process = child;
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        this.starting = null;
        resolve(ok);
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => this.onData(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { this.lastError = String(chunk).trim().slice(-2000); });
      child.on('error', error => {
        this.lastError = error.message;
        if (this.process === child) this.process = null;
        this.failAll(error);
        finish(false);
      });
      child.on('exit', code => {
        if (code && !this.lastError) this.lastError = `Asset backend exited with code ${code}.`;
        if (this.process === child) this.process = null;
        this.failAll(new Error(this.lastError || 'Asset backend stopped.'));
        finish(false);
      });

      const timer = setTimeout(() => {
        this.lastError ||= 'Asset backend did not respond to its startup check.';
        try { child.kill(); } catch {}
        finish(false);
      }, 9000);
      this.request('ping', {}, 8000).then(result => {
        clearTimeout(timer);
        if (!result?.ok) {
          this.lastError ||= result?.error || 'Asset backend startup check failed.';
          try { child.kill(); } catch {}
        }
        finish(Boolean(result?.ok));
      }).catch(error => {
        clearTimeout(timer);
        this.lastError = error.message;
        try { child.kill(); } catch {}
        finish(false);
      });
    });
    return this.starting;
  }

  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 32 * 1024 * 1024) {
      this.lastError = 'Asset backend produced an invalid oversized response.';
      this.buffer = '';
      this.failAll(new Error(this.lastError));
      return;
    }
    for (;;) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) break;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const pending = this.pending.get(String(msg.id));
        if (!pending) continue;
        this.pending.delete(String(msg.id));
        clearTimeout(pending.timer);
        pending.resolve(this.withUrl(msg.result));
      } catch {}
    }
  }

  withUrl(result) {
    if (!result || typeof result !== 'object') return result;
    if (typeof result.path === 'string' && path.isAbsolute(result.path)) result.url = pathToFileURL(result.path).href;
    return result;
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: error?.message || 'Asset backend stopped.' });
    }
    this.pending.clear();
  }

  async request(command, args = {}, timeout = 30000) {
    if ((!this.process || this.process.killed || this.process.exitCode != null) && command !== 'ping') {
      const ok = await this.start();
      if (!ok) return { ok: false, error: this.lastError || 'Asset backend unavailable.' };
    }
    if (!this.process || this.process.killed || this.process.exitCode != null || !this.process.stdin?.writable) return { ok: false, error: this.lastError || 'Asset backend unavailable.' };
    const id = String(++this.counter);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: `Asset backend timed out while running ${command}.` });
      }, timeout);
      this.pending.set(id, { resolve, timer });
      try {
        this.process.stdin.write(`${JSON.stringify({ id, command, args })}\n`, error => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          clearTimeout(pending.timer);
          pending.resolve({ ok: false, error: error.message });
        });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      }
    });
  }

  stop() {
    const child = this.process;
    this.process = null;
    this.buffer = '';
    this.failAll(new Error('Asset backend stopped.'));
    if (child && !child.killed && child.exitCode == null) {
      try { child.kill(); } catch {}
    }
  }
}

module.exports = { AssetHost };
