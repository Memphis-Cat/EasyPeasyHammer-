// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_RECORDS = 20000;
const MAX_LOG_FILE_BYTES = 20 * 1024 * 1024;
const FLUSH_MS = 180;

function stringify(value, depth = 0) {
  if (value == null) return String(value);
  if (value instanceof Error) return value.stack || value.message || String(value);
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 180)}… <string ${value.length.toLocaleString()} chars>` : value;
  if (typeof value !== 'object') return String(value);
  if (depth > 2) return '<object>';
  if (Array.isArray(value)) return `[${value.slice(0, 8).map(item => stringify(item, depth + 1)).join(', ')}${value.length > 8 ? `, … ${value.length} items` : ''}]`;
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 24)) {
    if (/password|token|secret|authorization/i.test(key)) out[key] = '<redacted>';
    else if (typeof item === 'string' && item.length > 500) out[key] = `${item.slice(0, 120)}… <string ${item.length.toLocaleString()} chars>`;
    else if (Array.isArray(item) && item.length > 32) out[key] = `<array ${item.length.toLocaleString()} items>`;
    else if (depth >= 2 && typeof item === 'object' && item) out[key] = '<object>';
    else out[key] = item;
  }
  try { return JSON.stringify(out); } catch { return String(value); }
}

function safeArgs(channel, args) {
  if (/collab:send-chat|profile:set/i.test(channel)) return `<${args.length} argument(s), contents redacted>`;
  return args.map(value => stringify(value)).join(' | ');
}

function registerAppLogService({ ipcMain, app }) {
  if (globalThis.__ephAppLogServiceV18) return;
  globalThis.__ephAppLogServiceV18 = true;

  const records = [];
  const pendingLines = [];
  let filePath = null;
  let flushTimer = null;
  let flushing = false;
  let installedWebContentsHook = false;

  function ensureFile() {
    if (filePath) return filePath;
    try {
      const folder = path.join(app.getPath('userData'), 'Logs');
      fs.mkdirSync(folder, { recursive: true });
      filePath = path.join(folder, 'EasyPeasyHammer-latest.log');
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_LOG_FILE_BYTES) {
          const previous = path.join(folder, 'EasyPeasyHammer-previous.log');
          fs.rmSync(previous, { force: true });
          fs.renameSync(filePath, previous);
        }
      } catch {}
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf8');
    } catch {}
    return filePath;
  }

  function lineFor(row) {
    return `${new Date(row.at).toISOString()} [${row.level.toUpperCase()}] [${row.source}] ${row.message}${row.meta ? ` | ${row.meta}` : ''}\n`;
  }

  function flushAsync() {
    if (flushing || !pendingLines.length) return;
    const target = ensureFile();
    if (!target) return;
    flushing = true;
    const payload = pendingLines.splice(0, pendingLines.length).join('');
    fs.appendFile(target, payload, 'utf8', () => {
      flushing = false;
      if (pendingLines.length) scheduleFlush();
    });
  }

  function flushSync() {
    if (!pendingLines.length) return;
    const target = ensureFile();
    if (!target) return;
    try { fs.appendFileSync(target, pendingLines.splice(0, pendingLines.length).join(''), 'utf8'); } catch {}
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushAsync();
    }, FLUSH_MS);
    flushTimer.unref?.();
  }

  function record(level = 'normal', source = 'app', message = '', meta = null) {
    const row = {
      at: Date.now(),
      level: level === 'error' ? 'error' : level === 'warning' || level === 'warn' ? 'warning' : 'normal',
      source: String(source || 'app'),
      message: String(message || ''),
      meta: meta == null ? '' : stringify(meta),
    };
    if (!row.message && !row.meta) return row;
    records.push(row);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    pendingLines.push(lineFor(row));
    scheduleFlush();
    return row;
  }

  globalThis.__ephAppLog = record;

  const rawHandle = ipcMain.handle.bind(ipcMain);
  rawHandle('app-log:get', () => ({ ok: true, records: records.slice(-MAX_RECORDS), filePath: ensureFile() }));
  rawHandle('app-log:record', (_event, payload = {}) => ({ ok: true, row: record(payload.level, payload.source || 'renderer', payload.message, payload.meta) }));
  rawHandle('app-log:clear', () => {
    records.length = 0;
    pendingLines.length = 0;
    try { const target = ensureFile(); if (target) fs.writeFileSync(target, '', 'utf8'); } catch {}
    record('normal', 'logger', 'Diagnostics log cleared.');
    return { ok: true };
  });

  // Install before the rest of the app registers IPC handlers. This gives the
  // diagnostics view timings/results for essentially every renderer -> main call.
  ipcMain.handle = function(channel, listener) {
    if (String(channel).startsWith('app-log:')) return rawHandle(channel, listener);
    return rawHandle(channel, async (event, ...args) => {
      const start = Date.now();
      record('normal', 'ipc', `→ ${channel}`, safeArgs(channel, args));
      try {
        const result = await listener(event, ...args);
        const elapsed = Date.now() - start;
        record(elapsed >= 750 ? 'warning' : 'normal', 'ipc', `← ${channel} (${elapsed} ms)`, stringify(result));
        return result;
      } catch (error) {
        record('error', 'ipc', `✕ ${channel} (${Date.now() - start} ms)`, error);
        throw error;
      }
    });
  };

  process.on('uncaughtExceptionMonitor', error => record('error', 'main:uncaught', error?.message || String(error), error));
  process.on('unhandledRejection', reason => record('error', 'main:promise', 'Unhandled rejection', reason));
  process.on('exit', flushSync);
  app.on('before-quit', flushSync);

  function hookWebContents() {
    if (installedWebContentsHook) return;
    installedWebContentsHook = true;
    app.on('web-contents-created', (_event, contents) => {
      record('normal', 'electron', `webContents created id=${contents.id} type=${contents.getType?.() || 'unknown'}`);
      contents.on('console-message', (_event, detailsOrLevel, messageMaybe, lineMaybe, sourceMaybe) => {
        const details = typeof detailsOrLevel === 'object' && detailsOrLevel ? detailsOrLevel : null;
        const level = details?.level || detailsOrLevel;
        const message = details?.message || messageMaybe || '';
        const source = details?.sourceId || sourceMaybe || 'renderer-console';
        const line = details?.lineNumber || lineMaybe || 0;
        const severity = /error/i.test(String(level)) || Number(level) >= 3 ? 'error' : /warn/i.test(String(level)) || Number(level) === 2 ? 'warning' : 'normal';
        record(severity, `console:${source}${line ? `:${line}` : ''}`, message);
      });
      contents.on('preload-error', (_event, preloadPath, error) => record('error', 'preload', `Preload failed: ${preloadPath}`, error));
      contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => record('error', 'navigation', `did-fail-load ${code}: ${description}`, { url, isMainFrame }));
      contents.on('render-process-gone', (_event, details) => record('error', 'renderer', 'Renderer process gone', details));
      contents.on('unresponsive', () => record('error', 'renderer', 'Renderer became unresponsive.'));
      contents.on('responsive', () => record('normal', 'renderer', 'Renderer became responsive again.'));
    });
    app.on('child-process-gone', (_event, details) => record('error', 'child-process', 'Electron child process gone', details));
  }

  hookWebContents();
  record('normal', 'app', '================ EasyPeasyHammer session started ================');
  record('normal', 'app', 'EasyPeasyHammer process starting.', { version: app.getVersion?.(), platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node });
}

module.exports = { registerAppLogService };
