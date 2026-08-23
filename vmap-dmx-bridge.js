// byanca
'use strict';

const { app, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertValidVmapText } = require('./vmap-text-preflight');
const { prepareLargeMapCache } = require('./large-map-service');

const MAX_INLINE_DECODE_BYTES = 64 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TOOL_OUTPUT = 2 * 1024 * 1024;
const activeConversions = new Map();
const cancelledSenders = new Set();

function safeJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function inspectVmap(vmapPath) {
  try {
    if (!vmapPath || path.extname(vmapPath).toLowerCase() !== '.vmap') return { ok: false, error: 'Only .vmap files are supported.' };
    if (!fs.existsSync(vmapPath)) return { ok: false, error: 'VMAP file does not exist.' };
    const stat = fs.statSync(vmapPath);
    const handle = fs.openSync(vmapPath, 'r');
    const buffer = Buffer.alloc(Math.min(1024, Math.max(1, stat.size)));
    let bytesRead = 0;
    try { bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0); }
    finally { fs.closeSync(handle); }
    const header = buffer.subarray(0, bytesRead).toString('latin1').replace(/^\uFEFF/, '');
    const match = header.match(/<!--\s*dmx\s+encoding\s+([a-z0-9_]+)\s+(\d+)\s+format\s+vmap\s+(\d+)\s*-->/i);
    return {
      ok: true,
      encoding: match?.[1]?.toLowerCase() || 'unknown',
      encodingVersion: match ? Number(match[2]) : null,
      formatVersion: match ? Number(match[3]) : null,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function normalizeRoot(candidate) {
  if (!candidate) return null;
  try {
    let root = path.resolve(String(candidate).trim().replace(/^"|"$/g, ''));
    if (path.basename(root).toLowerCase() === 'csgo') root = path.resolve(root, '..', '..');
    else if (path.basename(root).toLowerCase() === 'game') root = path.resolve(root, '..');
    return fs.existsSync(path.join(root, 'game', 'csgo', 'gameinfo.gi')) ? root : null;
  } catch { return null; }
}

function steamRoots() {
  const roots = [];
  const p86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const p64 = process.env.ProgramFiles || 'C:\\Program Files';
  for (const steamRoot of [path.join(p86, 'Steam'), path.join(p64, 'Steam')]) {
    roots.push(path.join(steamRoot, 'steamapps', 'common', 'Counter-Strike Global Offensive'));
    const libraries = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraries)) continue;
    try {
      const text = fs.readFileSync(libraries, 'utf8');
      for (const match of text.matchAll(/"path"\s*"([^"]+)"/gi)) {
        roots.push(path.join(match[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'Counter-Strike Global Offensive'));
      }
    } catch {}
  }
  return roots;
}

function findDmxConvert() {
  const candidates = [];
  try {
    const config = safeJson(path.join(app.getPath('userData'), 'asset-config.json'));
    if (config?.cs2Root) candidates.push(config.cs2Root);
  } catch {}
  if (process.env.EPH_CS2_PATH) candidates.push(process.env.EPH_CS2_PATH);
  candidates.push(...steamRoots());
  for (const candidate of candidates) {
    const root = normalizeRoot(candidate);
    if (!root) continue;
    const executable = path.join(root, 'game', 'bin', 'win64', 'dmxconvert.exe');
    if (fs.existsSync(executable)) return { executable, cs2Root: root };
  }
  return null;
}

function appendLimited(current, chunk) {
  if (current.length >= MAX_TOOL_OUTPUT) return current;
  return (current + String(chunk || '')).slice(0, MAX_TOOL_OUTPUT);
}

function progress(event, stage) {
  try { event?.sender?.send('vmap:load-progress', { stage, at: Date.now() }); } catch {}
}

function runConvert(event, executable, input, output, args) {
  const senderId = event?.sender?.id || 0;
  return new Promise(resolve => {
    let stdout = '', stderr = '', settled = false, timer = null, child = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (activeConversions.get(senderId) === child) activeConversions.delete(senderId);
      resolve({ stdout, stderr, ...result });
    };
    if (cancelledSenders.has(senderId)) return finish({ ok: false, cancelled: true, status: null, error: 'Load cancelled.' });
    try {
      child = spawn(executable, ['-i', input, '-o', output, ...args], { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      activeConversions.set(senderId, child);
    } catch (error) { finish({ ok: false, status: null, error: error?.message || String(error) }); return; }
    child.stdout?.on('data', chunk => { stdout = appendLimited(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = appendLimited(stderr, chunk); });
    child.on('error', error => finish({ ok: false, status: null, error: error?.message || String(error) }));
    child.on('close', status => {
      const cancelled = cancelledSenders.has(senderId);
      finish({ ok: !cancelled && status === 0 && fs.existsSync(output), cancelled, status, error: cancelled ? 'Load cancelled.' : status === 0 ? '' : `dmxconvert.exe exited with code ${status}` });
    });
    timer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, status: null, error: 'dmxconvert.exe timed out after 5 minutes.' }); }, CONVERT_TIMEOUT_MS);
  });
}

async function decodeBinaryVmap(event, vmapPath) {
  let output = null;
  const senderId = event?.sender?.id || 0;
  cancelledSenders.delete(senderId);
  try {
    const inspection = inspectVmap(vmapPath);
    if (!inspection.ok) return inspection;
    if (inspection.encoding !== 'binary') return { ok: false, error: `VMAP encoding is ${inspection.encoding}, not binary.` };
    const tool = findDmxConvert();
    if (!tool) return { ok: false, error: 'This is a binary Hammer VMAP, but CS2 dmxconvert.exe was not found. Install/open the CS2 Workshop Tools or configure the CS2 folder first.' };

    const tempRoot = path.join(app.getPath('temp'), 'EasyPeasyHammer', 'DMX');
    fs.mkdirSync(tempRoot, { recursive: true });
    output = path.join(tempRoot, `${crypto.randomUUID()}.dmx`);

    progress(event, 'convert');
    let conversion = await runConvert(event, tool.executable, path.resolve(vmapPath), output, ['-ie', 'binary', '-oe', 'keyvalues2', '-of', 'vmap']);
    if (conversion.cancelled) return { ok: false, cancelled: true, error: 'Load cancelled.' };
    if (!conversion.ok) {
      try { fs.rmSync(output, { force: true }); } catch {}
      progress(event, 'convert-retry');
      conversion = await runConvert(event, tool.executable, path.resolve(vmapPath), output, ['-oe', 'keyvalues2', '-of', 'vmap']);
    }
    if (conversion.cancelled) return { ok: false, cancelled: true, error: 'Load cancelled.' };
    if (!conversion.ok) {
      const detail = [conversion.error, conversion.stderr.trim(), conversion.stdout.trim()].filter(Boolean).join(' | ');
      return { ok: false, error: `dmxconvert.exe could not decode this VMAP${detail ? `: ${detail}` : '.'}` };
    }

    const decodedBytes = fs.statSync(output).size;
    if (decodedBytes > MAX_INLINE_DECODE_BYTES) {
      progress(event, 'index');
      const cache = await prepareLargeMapCache(app, vmapPath, output, inspection, () => cancelledSenders.has(senderId));
      if (cancelledSenders.has(senderId)) return { ok: false, cancelled: true, error: 'Load cancelled.' };
      progress(event, 'ready');
      return {
        ok: true,
        largeMap: true,
        largeMapToken: cache.token,
        largeMapEntries: cache.entries,
        meshCount: cache.meshCount,
        entityCount: cache.entityCount,
        sourceEncoding: 'binary',
        sourceEncodingVersion: inspection.encodingVersion,
        formatVersion: inspection.formatVersion,
        converter: tool.executable,
        size: inspection.size,
        modifiedAt: inspection.modifiedAt,
        decodedBytes: cache.decodedBytes,
      };
    }

    progress(event, 'parse');
    const text = fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '');
    assertValidVmapText(text);
    progress(event, 'ready');
    return { ok: true, text, sourceEncoding: 'binary', sourceEncodingVersion: inspection.encodingVersion, formatVersion: inspection.formatVersion, converter: tool.executable, size: inspection.size, modifiedAt: inspection.modifiedAt, decodedBytes };
  } catch (error) {
    if (error?.code === 'EPH_LOAD_CANCELLED' || cancelledSenders.has(senderId)) return { ok: false, cancelled: true, error: 'Load cancelled.' };
    return { ok: false, error: error?.message || String(error) };
  } finally {
    activeConversions.delete(senderId);
    cancelledSenders.delete(senderId);
    if (output) try { fs.rmSync(output, { force: true }); } catch {}
  }
}

function cancelDecode(event) {
  const senderId = event?.sender?.id || 0;
  cancelledSenders.add(senderId);
  const child = activeConversions.get(senderId);
  if (child) try { child.kill(); } catch {}
  return { ok: true };
}

ipcMain.handle('project:inspect-vmap', (_event, vmapPath) => inspectVmap(vmapPath));
ipcMain.handle('project:decode-vmap', (event, vmapPath) => decodeBinaryVmap(event, vmapPath));
ipcMain.handle('project:cancel-decode', event => cancelDecode(event));

module.exports = { inspectVmap, decodeBinaryVmap, findDmxConvert };
