// byanca
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BLOCKS = 24;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_PATCH_BYTES = 32 * 1024 * 1024;
const VALID_TOKEN = /^[a-f0-9]{40}$/i;
const caches = new Map();
const cancelledOpeners = new Set();

const cacheRoot = app => path.join(app.getPath('userData'), 'LargeMapCache');
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), 'utf8');
  try { fs.renameSync(temp, file); } catch { fs.copyFileSync(temp, file); fs.rmSync(temp, { force: true }); }
}
function tokenFor(sourcePath, inspection) {
  return crypto.createHash('sha1').update(`${path.resolve(sourcePath)}|${inspection?.size || 0}|${inspection?.modifiedAt || ''}`).digest('hex');
}
function unescapeValue(value) { return String(value || '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
function scalar(line) {
  const m = String(line || '').match(/^\s*"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s*,?\s*$/);
  return m ? { key: unescapeValue(m[1]), type: unescapeValue(m[2]), value: unescapeValue(m[3]) } : null;
}
function field(line) {
  const m = String(line || '').match(/^\s*"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s*$/);
  return m ? { key: unescapeValue(m[1]), type: unescapeValue(m[2]) } : null;
}
function vec(value, fallback) {
  const values = String(value || '').trim().split(/[\s,]+/).map(Number);
  return fallback.map((x, i) => Number.isFinite(values[i]) ? values[i] : x);
}
function classType(line) {
  const value = String(line || '').trim().replace(/,$/, '');
  if (/^"?CMapMesh"?$/i.test(value)) return 'mesh';
  if (/^"?CMapEntity"?$/i.test(value)) return 'entity';
  return null;
}
function braceDelta(line) {
  let value = 0, quoted = false, escaped = false;
  for (const c of String(line || '')) {
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quoted) { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === '{') value++; else if (c === '}') value--;
  }
  return value;
}

async function scanDecodedVmap(filePath, shouldCancel = () => false) {
  const entries = [];
  const active = [];
  let depth = 0, pending = null, sequence = 0;
  let worldPending = false, worldDepth = null, childrenPending = false, arrayDepth = 0, worldChildrenClose = null;

  function finish(block, end) {
    const fallback = `${block.type}-${block.index}`;
    entries.push({
      entryId: `large:${block.index}`,
      dmxId: block.id || null,
      type: block.type,
      start: block.start,
      length: Math.max(0, end - block.start),
      parentEntryId: block.parentEntryId || null,
      position: block.position,
      rotation: block.rotation,
      scale: block.scale,
      visible: block.visible,
      className: block.className || null,
      targetname: block.targetname || null,
      model: block.model || null,
      nodeID: block.nodeID || null,
      label: block.targetname || block.className || (block.type === 'mesh' ? `Mesh_${block.nodeID || fallback}` : fallback),
      approxRadius: block.type === 'mesh' ? 1536 : 128,
    });
  }

  function processLine(buffer, start, end) {
    const line = buffer.toString('utf8').replace(/\r$/, '');
    const type = classType(line);
    const trimmed = line.trim().replace(/,$/, '');
    const f = field(line);
    if (/^"?CMapWorld"?$/i.test(trimmed) || f?.type === 'CMapWorld') worldPending = true;
    if (type) pending = { type, start, baseDepth: depth, parentEntryId: active.at(-1)?.entryId || null };
    const before = depth;
    const delta = braceDelta(line);

    if (worldPending && delta > 0) { worldDepth = before + delta; worldPending = false; }
    if (worldDepth != null && before === worldDepth) {
      const top = field(line);
      if (top?.key === 'children' && top?.type === 'element_array') childrenPending = true;
    }
    if (childrenPending && arrayDepth === 0 && line.includes('[')) { arrayDepth = 1; childrenPending = false; }
    else if (arrayDepth > 0) {
      let quoted = false, escaped = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\' && quoted) { escaped = true; continue; }
        if (c === '"') { quoted = !quoted; continue; }
        if (quoted) continue;
        if (c === '[') arrayDepth++;
        else if (c === ']') {
          arrayDepth--;
          if (arrayDepth === 0 && worldChildrenClose == null) { worldChildrenClose = start + Buffer.byteLength(line.slice(0, i), 'utf8'); break; }
        }
      }
    }

    if (pending && delta > 0 && before === pending.baseDepth) {
      const index = ++sequence;
      active.push({ ...pending, index, entryId: `large:${index}`, contentDepth: before + delta, id: null, nodeID: null, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], visible: true, className: null, targetname: null, model: null });
      pending = null;
    }

    const value = scalar(line);
    if (value) {
      for (const block of active) {
        const relative = before - (block.contentDepth - 1);
        if (relative === 1) {
          if (value.key === 'id') block.id = value.value;
          else if (value.key === 'nodeID') block.nodeID = value.value;
          else if (value.key === 'origin') block.position = vec(value.value, [0,0,0]);
          else if (value.key === 'angles') block.rotation = vec(value.value, [0,0,0]);
          else if (value.key === 'scales') block.scale = vec(value.value, [1,1,1]);
          else if (value.key === 'force_hidden') block.visible = value.value !== '1';
        }
        if (block.type === 'entity') {
          if (value.key === 'classname' && !block.className) block.className = value.value;
          else if (value.key === 'targetname' && !block.targetname) block.targetname = value.value;
          else if (value.key === 'model' && !block.model) block.model = value.value;
        }
      }
    }

    depth += delta;
    if (worldDepth != null && depth < worldDepth) worldDepth = null;
    for (let i = active.length - 1; i >= 0; i--) {
      if (depth < active[i].contentDepth) { const block = active.splice(i, 1)[0]; finish(block, end); }
    }
  }

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    let carry = Buffer.alloc(0), carryStart = 0, nextStart = 0;
    stream.on('data', chunk => {
      if (shouldCancel()) { const error = new Error('Load cancelled.'); error.code = 'EPH_LOAD_CANCELLED'; stream.destroy(error); return; }
      const combined = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const base = carry.length ? carryStart : nextStart;
      let offset = 0;
      for (let i = 0; i < combined.length; i++) {
        if (combined[i] !== 10) continue;
        processLine(combined.subarray(offset, i), base + offset, base + i + 1);
        offset = i + 1;
      }
      carry = combined.subarray(offset); carryStart = base + offset; nextStart += chunk.length;
    });
    stream.on('end', () => { if (carry.length) processLine(carry, carryStart, carryStart + carry.length); resolve(); });
    stream.on('error', reject);
  });
  return { version: 2, entries, meshCount: entries.filter(x => x.type === 'mesh').length, entityCount: entries.filter(x => x.type === 'entity').length, worldChildrenClose };
}

async function prepareLargeMapCache(app, sourcePath, decodedPath, inspection = {}, shouldCancel = () => false) {
  if (shouldCancel()) { const error = new Error('Load cancelled.'); error.code = 'EPH_LOAD_CANCELLED'; throw error; }
  const token = tokenFor(sourcePath, inspection);
  const folder = path.join(cacheRoot(app), token);
  const mapFile = path.join(folder, 'decoded.vmap');
  const indexFile = path.join(folder, 'index.json');
  fs.mkdirSync(folder, { recursive: true });
  let index = readJson(indexFile);
  const valid = index?.version === 2 && fs.existsSync(mapFile) && Number(index.sourceSize) === Number(inspection.size || 0) && String(index.sourceModifiedAt || '') === String(inspection.modifiedAt || '');
  if (!valid) {
    if (path.resolve(decodedPath) !== path.resolve(mapFile)) fs.copyFileSync(decodedPath, mapFile);
    const scanned = await scanDecodedVmap(mapFile, shouldCancel);
    index = { ...scanned, sourcePath: path.resolve(sourcePath), sourceSize: inspection.size || 0, sourceModifiedAt: inspection.modifiedAt || null, decodedBytes: fs.statSync(mapFile).size };
    writeJson(indexFile, index);
  }
  const cache = { token, folder, filePath: mapFile, index, byId: new Map(index.entries.map(x => [x.entryId, x])) };
  caches.set(token, cache);
  return { token, decodedBytes: index.decodedBytes, meshCount: index.meshCount, entityCount: index.entityCount, entries: index.entries.map(({ start, length, ...entry }) => entry) };
}

function loadCache(app, token) {
  const normalizedToken = String(token || '');
  if (!VALID_TOKEN.test(normalizedToken)) return null;
  if (caches.has(normalizedToken)) return caches.get(normalizedToken);
  const folder = path.join(cacheRoot(app), normalizedToken);
  const index = readJson(path.join(folder, 'index.json'));
  const filePath = path.join(folder, 'decoded.vmap');
  if (!index?.entries || !fs.existsSync(filePath)) return null;
  const cache = { token: normalizedToken, folder, filePath, index, byId: new Map(index.entries.map(x => [x.entryId, x])) };
  caches.set(normalizedToken, cache);
  return cache;
}

function getBlocks(app, token, ids) {
  const cache = loadCache(app, token);
  if (!cache) return { ok: false, error: 'Large-map cache is unavailable.' };
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, MAX_BLOCKS);
  const fd = fs.openSync(cache.filePath, 'r');
  const blocks = [];
  let total = 0;
  try {
    for (const id of wanted) {
      const entry = cache.byId.get(id);
      if (!entry?.length) continue;
      if (!Number.isSafeInteger(entry.length) || entry.length <= 0 || entry.length > MAX_RESPONSE_BYTES) {
        return { ok: false, error: `Large-map block ${id} exceeds the safe response limit.` };
      }
      if (total + entry.length > MAX_RESPONSE_BYTES) break;
      const buffer = Buffer.alloc(entry.length);
      const bytes = fs.readSync(fd, buffer, 0, entry.length, entry.start);
      blocks.push({ entryId: id, text: buffer.subarray(0, bytes).toString('utf8') });
      total += bytes;
    }
  } finally { fs.closeSync(fd); }
  return { ok: true, blocks, bytes: total };
}

function replacementPlan(cache, patches) {
  const input = new Map((patches || []).filter(x => x?.entryId && typeof x.text === 'string').map(x => [String(x.entryId), x]));
  for (const id of [...input.keys()]) {
    let parent = cache.byId.get(id)?.parentEntryId || null;
    while (parent) {
      if (input.has(parent)) { input.delete(id); break; }
      parent = cache.byId.get(parent)?.parentEntryId || null;
    }
  }
  return [...input.values()].map(patch => ({ entry: cache.byId.get(String(patch.entryId)), text: patch.text })).filter(x => x.entry).sort((a, b) => a.entry.start - b.entry.start);
}

function patchBytes(replacements, additions) {
  let total = 0;
  for (const item of replacements) total += Buffer.byteLength(String(item.text || ''), 'utf8');
  for (const item of additions) total += Buffer.byteLength(String(item || ''), 'utf8');
  return total;
}

async function saveLargeMap(app, token, targetPath, patches = [], newBlocks = []) {
  const cache = loadCache(app, token);
  if (!cache) return { ok: false, error: 'Large-map cache is unavailable.' };
  const replacements = replacementPlan(cache, patches);
  const additions = (Array.isArray(newBlocks) ? newBlocks : []).map(String).filter(Boolean);
  if (patchBytes(replacements, additions) > MAX_PATCH_BYTES) return { ok: false, error: 'Large-map edit payload exceeds the 32 MB safety limit.' };
  if (!replacements.length && !additions.length) return { ok: true, unchanged: true, largeMapToken: token, entries: cache.index.entries.map(({start,length,...x}) => x) };
  const source = path.resolve(String(cache.index.sourcePath || ''));
  const target = path.resolve(String(targetPath || source));
  if (path.extname(target).toLowerCase() !== '.vmap') return { ok: false, error: 'Invalid VMAP path.' };
  if (target.toLowerCase() !== source.toLowerCase()) return { ok: false, error: 'Large-map save target does not match the opened VMAP.' };
  const temp = `${target}.eph-large-tmp`;
  const backup = fs.existsSync(target) ? `${target}.eph-backup` : null;
  if (backup) fs.copyFileSync(target, backup);
  const out = fs.createWriteStream(temp);
  let cursor = 0;
  const copy = (start, end) => new Promise((resolve, reject) => {
    if (end <= start) return resolve();
    const stream = fs.createReadStream(cache.filePath, { start, end: end - 1 });
    stream.on('error', reject); stream.on('end', resolve); stream.pipe(out, { end: false });
  });
  try {
    const insertAt = Number(cache.index.worldChildrenClose);
    let inserted = false;
    const addNew = async () => {
      if (inserted || !additions.length || !Number.isFinite(insertAt)) return;
      await copy(cursor, insertAt);
      const probeStart = Math.max(0, insertAt - 256);
      const probe = Buffer.alloc(insertAt - probeStart);
      const fd = fs.openSync(cache.filePath, 'r');
      try { fs.readSync(fd, probe, 0, probe.length, probeStart); } finally { fs.closeSync(fd); }
      const last = probe.toString('utf8').trim().slice(-1);
      out.write(`${last && last !== '[' ? ',\n' : '\n'}${additions.join(',\n')}\n`, 'utf8');
      cursor = insertAt; inserted = true;
    };
    for (const item of replacements) {
      if (!inserted && additions.length && Number.isFinite(insertAt) && insertAt <= item.entry.start) await addNew();
      await copy(cursor, item.entry.start);
      out.write(item.text, 'utf8');
      cursor = item.entry.start + item.entry.length;
    }
    if (!inserted && additions.length) await addNew();
    await copy(cursor, fs.statSync(cache.filePath).size);
    await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
    try {
      fs.renameSync(temp, target);
    } catch (error) {
      // Windows commonly refuses rename-over-existing. Keep the backup above,
      // replace from the fully written temp, then remove the temp only on success.
      if (!fs.existsSync(target)) throw error;
      fs.copyFileSync(temp, target);
      fs.rmSync(temp, { force: true });
    }
    const stat = fs.statSync(target);
    const refreshed = await prepareLargeMapCache(app, target, target, { size: stat.size, modifiedAt: stat.mtime.toISOString() });
    return { ok: true, backupPath: backup, largeMapToken: refreshed.token, entries: refreshed.entries, meshCount: refreshed.meshCount, entityCount: refreshed.entityCount, decodedBytes: refreshed.decodedBytes };
  } catch (error) {
    try { out.destroy(); } catch {}
    try { fs.rmSync(temp, { force: true }); } catch {}
    if (backup && fs.existsSync(backup)) try { fs.copyFileSync(backup, target); } catch {}
    return { ok: false, error: error?.message || String(error) };
  }
}

async function openLargeText(app, event, vmapPath) {
  const sender = event?.sender?.id || 0;
  cancelledOpeners.delete(sender);
  try {
    const target = path.resolve(String(vmapPath || ''));
    if (path.extname(target).toLowerCase() !== '.vmap') return { ok: false, error: 'Only .vmap files can be opened as large maps.' };
    if (!fs.existsSync(target)) return { ok: false, error: 'VMAP file does not exist.' };
    const stat = fs.statSync(target);
    const cache = await prepareLargeMapCache(app, target, target, { size: stat.size, modifiedAt: stat.mtime.toISOString() }, () => cancelledOpeners.has(sender));
    return { ok: true, largeMap: true, largeMapToken: cache.token, largeMapEntries: cache.entries, meshCount: cache.meshCount, entityCount: cache.entityCount, decodedBytes: cache.decodedBytes, size: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch (error) {
    if (error?.code === 'EPH_LOAD_CANCELLED') return { ok: false, cancelled: true, error: 'Load cancelled.' };
    return { ok: false, error: error?.message || String(error) };
  } finally { cancelledOpeners.delete(sender); }
}

function registerLargeMapService({ ipcMain, app }) {
  if (globalThis.__ephLargeMapService) return;
  globalThis.__ephLargeMapService = true;
  ipcMain.handle('large-map:get-blocks', (_event, token, ids) => getBlocks(app, token, ids));
  ipcMain.handle('large-map:release', (_event, token) => {
    const normalized = String(token || '');
    if (VALID_TOKEN.test(normalized)) caches.delete(normalized);
    return { ok: true };
  });
  ipcMain.handle('large-map:open-text', (event, mapPath) => openLargeText(app, event, mapPath));
  ipcMain.handle('large-map:cancel-open', event => { cancelledOpeners.add(event?.sender?.id || 0); return { ok: true }; });
  ipcMain.handle('large-map:save', (_event, token, target, patches, newBlocks) => saveLargeMap(app, token, target, patches, newBlocks));
}

module.exports = { registerLargeMapService, prepareLargeMapCache, scanDecodedVmap, saveLargeMap };
