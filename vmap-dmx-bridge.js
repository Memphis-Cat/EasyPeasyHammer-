// byanca
'use strict';

const { app, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { assertValidVmapText } = require('./vmap-text-preflight');

const MAX_INLINE_DECODE_BYTES = 64 * 1024 * 1024;
const MAX_SUMMARY_ENTITIES = 12000;
const CONVERT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TOOL_OUTPUT = 2 * 1024 * 1024;

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

function appendLimited(current, chunk) {
  if (current.length >= MAX_TOOL_OUTPUT) return current;
  return (current + String(chunk || '')).slice(0, MAX_TOOL_OUTPUT);
}

function runConvert(executable, input, output, args) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let child = null;

    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };

    try {
      child = spawn(executable, ['-i', input, '-o', output, ...args], {
        cwd: path.dirname(executable),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finish({ ok: false, status: null, error: error?.message || String(error) });
      return;
    }

    child.stdout?.on('data', chunk => { stdout = appendLimited(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = appendLimited(stderr, chunk); });
    child.on('error', error => finish({ ok: false, status: null, error: error?.message || String(error) }));
    child.on('close', status => finish({
      ok: status === 0 && fs.existsSync(output),
      status,
      error: status === 0 ? '' : `dmxconvert.exe exited with code ${status}`
    }));

    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, status: null, error: 'dmxconvert.exe timed out after 5 minutes.' });
    }, CONVERT_TIMEOUT_MS);
  });
}

function braceDelta(line) {
  let delta = 0;
  let quoted = false;
  let escaped = false;
  for (const char of String(line || '')) {
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { if (quoted) escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '{') delta++;
    else if (char === '}') delta--;
  }
  return delta;
}

function unescapeValue(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function scalarLine(line) {
  const match = String(line || '').match(/^\s*"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s*,?\s*$/);
  if (!match) return null;
  return { key: unescapeValue(match[1]), type: unescapeValue(match[2]), value: unescapeValue(match[3]) };
}

function fieldLine(line) {
  const match = String(line || '').match(/^\s*"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s*$/);
  if (!match) return null;
  return { key: unescapeValue(match[1]), type: unescapeValue(match[2]) };
}

function vector(value, fallback) {
  const numbers = String(value || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  return fallback.map((defaultValue, index) => Number.isFinite(numbers[index]) ? numbers[index] : defaultValue);
}

function isClassLine(line, name) {
  return new RegExp(`^"?${name}"?[,]?$`, 'i').test(String(line || '').trim());
}

async function extractLargeVmapSummary(filePath) {
  const entities = [];
  const classCounts = new Map();
  let meshCount = 0;
  let totalEntityCount = 0;
  let pendingEntity = false;
  let inEntity = false;
  let depth = 0;
  let pendingProperties = false;
  let propertiesDepth = null;
  let entity = null;

  const finalizeEntity = () => {
    if (!entity) return;
    totalEntityCount++;
    const props = entity.entityProperties || {};
    const className = String(props.classname || entity.className || 'info_target');
    classCounts.set(className, (classCounts.get(className) || 0) + 1);
    if (entities.length < MAX_SUMMARY_ENTITIES) {
      const model = String(props.model || '');
      const name = String(props.targetname || '') || className;
      entities.push({
        id: entity.id || null,
        className,
        name,
        model,
        position: entity.position || [0, 0, 0],
        rotation: entity.rotation || [0, 0, 0],
        scale: entity.scale || [1, 1, 1],
        visible: entity.visible !== false,
        entityProperties: props,
      });
    }
    entity = null;
  };

  const input = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      const trimmed = line.trim();

      if (!inEntity) {
        if (isClassLine(trimmed, 'CMapMesh')) meshCount++;
        if (isClassLine(trimmed, 'CMapEntity')) {
          pendingEntity = true;
          continue;
        }
        if (!pendingEntity) continue;
        const delta = braceDelta(line);
        if (delta > 0) {
          inEntity = true;
          depth = delta;
          pendingEntity = false;
          pendingProperties = false;
          propertiesDepth = null;
          entity = {
            id: null,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            visible: true,
            entityProperties: {},
          };
        } else if (trimmed && !trimmed.startsWith('//')) {
          pendingEntity = false;
        }
        continue;
      }

      if (isClassLine(trimmed, 'CMapMesh')) meshCount++;

      const scalar = scalarLine(line);
      if (scalar) {
        if (propertiesDepth != null && depth === propertiesDepth) {
          if (Object.keys(entity.entityProperties).length < 300 && scalar.value.length <= 16384) {
            entity.entityProperties[scalar.key] = scalar.value;
          }
        } else if (depth === 1) {
          if (scalar.key === 'id') entity.id = scalar.value;
          else if (scalar.key === 'origin') entity.position = vector(scalar.value, [0, 0, 0]);
          else if (scalar.key === 'angles') entity.rotation = vector(scalar.value, [0, 0, 0]);
          else if (scalar.key === 'scales') entity.scale = vector(scalar.value, [1, 1, 1]);
          else if (scalar.key === 'force_hidden') entity.visible = scalar.value !== '1';
        }
      } else if (depth === 1) {
        const field = fieldLine(line);
        if (field?.key === 'entity_properties') pendingProperties = true;
      }

      const delta = braceDelta(line);
      if (pendingProperties && delta > 0 && depth === 1) {
        propertiesDepth = depth + delta;
        pendingProperties = false;
      }
      depth += delta;
      if (propertiesDepth != null && depth < propertiesDepth) propertiesDepth = null;

      if (depth <= 0) {
        inEntity = false;
        pendingProperties = false;
        propertiesDepth = null;
        finalizeEntity();
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }

  if (inEntity) finalizeEntity();

  return {
    entities,
    entityCount: totalEntityCount,
    entityLimitReached: totalEntityCount > entities.length,
    meshCount,
    classCounts: [...classCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([className, count]) => ({ className, count }))
  };
}

async function decodeBinaryVmap(vmapPath) {
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

    let conversion = await runConvert(tool.executable, path.resolve(vmapPath), output, ['-ie', 'binary', '-oe', 'keyvalues2', '-of', 'vmap']);
    if (!conversion.ok) {
      try { fs.rmSync(output, { force: true }); } catch {}
      conversion = await runConvert(tool.executable, path.resolve(vmapPath), output, ['-oe', 'keyvalues2', '-of', 'vmap']);
    }
    if (!conversion.ok) {
      const detail = [conversion.error, conversion.stderr.trim(), conversion.stdout.trim()].filter(Boolean).join(' | ');
      return { ok: false, error: `dmxconvert.exe could not decode this VMAP${detail ? `: ${detail}` : '.'}` };
    }

    const decodedBytes = fs.statSync(output).size;
    if (decodedBytes > MAX_INLINE_DECODE_BYTES) {
      const summary = await extractLargeVmapSummary(output);
      return {
        ok: true,
        largeCompatibility: true,
        readOnlySource: true,
        entities: summary.entities,
        entityCount: summary.entityCount,
        entityLimitReached: summary.entityLimitReached,
        meshCount: summary.meshCount,
        classCounts: summary.classCounts,
        warning: `This VMAP expands to ${(decodedBytes / 1024 / 1024).toFixed(1)} MB of text. EasyPeasyHammer loaded its entities in Large Map Compatibility Mode and deferred heavy mesh geometry so the renderer stays responsive.`,
        sourceEncoding: 'binary',
        sourceEncodingVersion: inspection.encodingVersion,
        formatVersion: inspection.formatVersion,
        converter: tool.executable,
        size: inspection.size,
        modifiedAt: inspection.modifiedAt,
        decodedBytes,
        inlineDecodeLimit: MAX_INLINE_DECODE_BYTES,
      };
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
      decodedBytes
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    if (output) try { fs.rmSync(output, { force: true }); } catch {}
  }
}

ipcMain.handle('project:inspect-vmap', (_event, vmapPath) => inspectVmap(vmapPath));
ipcMain.handle('project:decode-vmap', (_event, vmapPath) => decodeBinaryVmap(vmapPath));

module.exports = { inspectVmap, decodeBinaryVmap, findDmxConvert, extractLargeVmapSummary };
