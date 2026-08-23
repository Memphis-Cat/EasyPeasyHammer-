// byanca
'use strict';

const { app, ipcMain } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertValidVmapText } = require('./vmap-text-preflight');

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
  } catch {
    return null;
  }
}

function steamRoots() {
  const roots = [];
  const programFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const steamInstalls = [path.join(programFiles86, 'Steam'), path.join(programFiles, 'Steam')];
  for (const steamRoot of steamInstalls) {
    roots.push(path.join(steamRoot, 'steamapps', 'common', 'Counter-Strike Global Offensive'));
    const libraries = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraries)) continue;
    try {
      const text = fs.readFileSync(libraries, 'utf8');
      for (const match of text.matchAll(/"path"\s*"([^"]+)"/gi)) {
        const library = match[1].replace(/\\\\/g, '\\');
        roots.push(path.join(library, 'steamapps', 'common', 'Counter-Strike Global Offensive'));
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

function runConvert(executable, input, output, args) {
  const result = spawnSync(executable, ['-i', input, '-o', output, ...args], {
    cwd: path.dirname(executable),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024
  });
  return {
    ok: !result.error && result.status === 0 && fs.existsSync(output),
    status: result.status,
    error: result.error?.message || '',
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

function decodeBinaryVmap(vmapPath) {
  let output = null;
  try {
    const inspection = inspectVmap(vmapPath);
    if (!inspection.ok) return inspection;
    if (inspection.encoding !== 'binary') return { ok: false, error: `VMAP encoding is ${inspection.encoding}, not binary.` };

    const tool = findDmxConvert();
    if (!tool) return { ok: false, error: 'This is a binary Hammer VMAP, but CS2 dmxconvert.exe was not found. Install/open the CS2 Workshop Tools or configure the CS2 folder first.' };

    const tempRoot = path.join(app.getPath('temp'), 'EasyPeasyHammer', 'DMX');
    fs.mkdirSync(tempRoot, { recursive: true });
    output = path.join(tempRoot, `${crypto.randomUUID()}.dmx`);

    let conversion = runConvert(tool.executable, path.resolve(vmapPath), output, ['-ie', 'binary', '-oe', 'keyvalues2', '-of', 'vmap']);
    if (!conversion.ok) {
      try { fs.rmSync(output, { force: true }); } catch {}
      conversion = runConvert(tool.executable, path.resolve(vmapPath), output, ['-oe', 'keyvalues2', '-of', 'vmap']);
    }
    if (!conversion.ok) {
      const detail = [conversion.error, conversion.stderr.trim(), conversion.stdout.trim()].filter(Boolean).join(' | ');
      return { ok: false, error: `dmxconvert.exe could not decode this VMAP${detail ? `: ${detail}` : '.'}` };
    }

    const text = fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '');
    assertValidVmapText(text);
    return {
      ok: true,
      text,
      sourceEncoding: 'binary',
      sourceEncodingVersion: inspection.encodingVersion,
      formatVersion: inspection.formatVersion,
      converter: tool.executable,
      size: inspection.size,
      modifiedAt: inspection.modifiedAt,
      decodedBytes: Buffer.byteLength(text, 'utf8')
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    if (output) try { fs.rmSync(output, { force: true }); } catch {}
  }
}

ipcMain.handle('project:inspect-vmap', (_event, vmapPath) => inspectVmap(vmapPath));
ipcMain.handle('project:decode-vmap', (_event, vmapPath) => decodeBinaryVmap(vmapPath));

module.exports = { inspectVmap, decodeBinaryVmap, findDmxConvert };
