// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const SPATIAL_VERSION = 19;
const MAX_VECTOR_ABS = 10_000_000;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function writeJson(file, value) {
  const temp = `${file}.spatial.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), 'utf8');
  try { fs.renameSync(temp, file); }
  catch {
    fs.copyFileSync(temp, file);
    fs.rmSync(temp, { force: true });
  }
}

function unescapeValue(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function scalar(line) {
  const match = String(line || '').match(/^\s*"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s*,?\s*$/);
  return match ? { key: unescapeValue(match[1]), type: unescapeValue(match[2]), value: unescapeValue(match[3]) } : null;
}

function field(line) {
  const match = String(line || '').match(/^\s*"((?:\\.|[^"])*)"\s+"((?:\\.|[^"])*)"\s*$/);
  return match ? { key: unescapeValue(match[1]), type: unescapeValue(match[2]) } : null;
}

function arrayItem(line) {
  const match = String(line || '').match(/^\s*"((?:\\.|[^"])*)"\s*,?\s*$/);
  return match ? unescapeValue(match[1]) : null;
}

function braceDelta(text) {
  let depth = 0, quoted = false, escaped = false;
  for (const char of String(text || '')) {
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  return depth;
}

function bracketDelta(text) {
  let depth = 0, quoted = false, escaped = false;
  for (const char of String(text || '')) {
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '[') depth++;
    else if (char === ']') depth--;
  }
  return depth;
}

function vector3(text) {
  const values = String(text || '').trim().split(/[\s,]+/).map(Number);
  if (values.length < 3 || !values.slice(0, 3).every(Number.isFinite)) return null;
  const output = values.slice(0, 3);
  if (output.some(value => Math.abs(value) > MAX_VECTOR_ABS)) return null;
  return output;
}

function addVector(state, vector) {
  if (!vector) return;
  if (!state.min) {
    state.min = [...vector];
    state.max = [...vector];
  } else {
    for (let index = 0; index < 3; index++) {
      state.min[index] = Math.min(state.min[index], vector[index]);
      state.max[index] = Math.max(state.max[index], vector[index]);
    }
  }
  state.vertexCount++;
}

function finalizeState(state) {
  const entry = state.entry;
  if (!state.min || !state.max || state.vertexCount < 1) return false;
  const center = state.min.map((value, index) => (value + state.max[index]) / 2);
  const half = state.min.map((value, index) => Math.abs(state.max[index] - value) / 2);
  const radius = Math.max(4, Math.hypot(half[0], half[1], half[2]));
  const origin = Array.isArray(entry.position) ? entry.position.map(Number) : [0, 0, 0];
  entry.spatialCenter = center;
  entry.spatialPosition = center.map((value, index) => value + (Number.isFinite(origin[index]) ? origin[index] : 0));
  entry.spatialRadius = radius;
  entry.spatialVertexCount = state.vertexCount;
  entry.approxRadius = radius;
  return true;
}

async function buildSpatialIndex(app, token) {
  const folder = path.join(app.getPath('userData'), 'LargeMapCache', String(token || ''));
  const indexFile = path.join(folder, 'index.json');
  const mapFile = path.join(folder, 'decoded.vmap');
  const index = readJson(indexFile);
  if (!index?.entries || !fs.existsSync(mapFile)) return { ok: false, error: 'Large-map cache is unavailable.' };

  if (Number(index.spatialVersion) === SPATIAL_VERSION) {
    const entries = index.entries.map(({ start, length, ...entry }) => entry);
    return {
      ok: true,
      cached: true,
      spatialVersion: SPATIAL_VERSION,
      entries,
      boundedMeshes: entries.filter(entry => entry.type === 'mesh' && Array.isArray(entry.spatialPosition)).length,
      meshCount: index.meshCount || entries.filter(entry => entry.type === 'mesh').length,
    };
  }

  const meshEntries = index.entries
    .filter(entry => entry?.type === 'mesh' && Number.isFinite(Number(entry.start)) && Number(entry.length) > 0)
    .sort((a, b) => Number(a.start) - Number(b.start));

  const states = new Map(meshEntries.map(entry => [entry.entryId, {
    entry,
    end: Number(entry.start) + Number(entry.length),
    streamDepth: null,
    awaitingDataArray: false,
    dataArrayDepth: 0,
    min: null,
    max: null,
    vertexCount: 0,
  }]));

  let nextMesh = 0;
  let active = [];
  let depth = 0;
  let processedBytes = 0;
  const totalBytes = fs.statSync(mapFile).size;
  let lastProgress = 0;

  function processLine(buffer, start, end) {
    while (nextMesh < meshEntries.length && Number(meshEntries[nextMesh].start) <= start) {
      const entry = meshEntries[nextMesh++];
      const state = states.get(entry.entryId);
      if (state && state.end > start) active.push(state);
    }
    if (active.length) active = active.filter(state => state.end > start);

    const line = buffer.toString('utf8').replace(/\r$/, '');
    const before = depth;
    const value = scalar(line);
    const topField = field(line);

    for (const state of active) {
      if (state.streamDepth != null && before < state.streamDepth) {
        state.streamDepth = null;
        state.awaitingDataArray = false;
        state.dataArrayDepth = 0;
      }

      if (value?.key === 'name' && value.value === 'position:0') {
        state.streamDepth = before;
        state.awaitingDataArray = false;
        state.dataArrayDepth = 0;
      }

      if (state.streamDepth != null && state.dataArrayDepth === 0 && topField?.key === 'data' && /vector3_array/i.test(topField.type)) {
        state.awaitingDataArray = true;
      }

      if (state.awaitingDataArray) {
        const brackets = bracketDelta(line);
        if (brackets > 0 || line.trim() === '[') {
          state.dataArrayDepth = Math.max(1, brackets);
          state.awaitingDataArray = false;
          continue;
        }
      } else if (state.dataArrayDepth > 0) {
        const item = arrayItem(line);
        if (item != null) addVector(state, vector3(item));
        state.dataArrayDepth += bracketDelta(line);
        if (state.dataArrayDepth <= 0) {
          state.dataArrayDepth = 0;
          state.streamDepth = null;
        }
      }
    }

    depth += braceDelta(line);
    processedBytes = end;
    const now = Date.now();
    if (now - lastProgress > 1500) {
      lastProgress = now;
      globalThis.__ephAppLog?.('normal', 'large-map-spatial', 'Spatial index progress.', {
        percent: totalBytes ? Number(((processedBytes / totalBytes) * 100).toFixed(1)) : 0,
        activeMeshes: active.length,
      });
    }
  }

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(mapFile, { highWaterMark: 2 * 1024 * 1024 });
    let carry = Buffer.alloc(0), carryStart = 0, nextStart = 0;
    stream.on('data', chunk => {
      const combined = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const base = carry.length ? carryStart : nextStart;
      let offset = 0;
      for (let index = 0; index < combined.length; index++) {
        if (combined[index] !== 10) continue;
        processLine(combined.subarray(offset, index), base + offset, base + index + 1);
        offset = index + 1;
      }
      carry = combined.subarray(offset);
      carryStart = base + offset;
      nextStart += chunk.length;
    });
    stream.on('end', () => {
      if (carry.length) processLine(carry, carryStart, carryStart + carry.length);
      resolve();
    });
    stream.on('error', reject);
  });

  let boundedMeshes = 0;
  for (const state of states.values()) if (finalizeState(state)) boundedMeshes++;
  index.spatialVersion = SPATIAL_VERSION;
  index.spatialIndexedAt = new Date().toISOString();
  index.spatialBoundedMeshes = boundedMeshes;
  writeJson(indexFile, index);

  const entries = index.entries.map(({ start, length, ...entry }) => entry);
  globalThis.__ephAppLog?.('normal', 'large-map-spatial', 'Spatial index complete.', {
    boundedMeshes,
    meshCount: index.meshCount,
    entries: entries.length,
    decodedBytes: totalBytes,
  });

  return {
    ok: true,
    cached: false,
    spatialVersion: SPATIAL_VERSION,
    entries,
    boundedMeshes,
    meshCount: index.meshCount || meshEntries.length,
  };
}

function registerLargeMapSpatialServiceV19({ ipcMain, app }) {
  if (globalThis.__ephLargeMapSpatialServiceV19) return;
  globalThis.__ephLargeMapSpatialServiceV19 = true;
  ipcMain.handle('large-map:spatial-index', (_event, token) => buildSpatialIndex(app, token));
}

module.exports = { registerLargeMapSpatialServiceV19, buildSpatialIndex };
