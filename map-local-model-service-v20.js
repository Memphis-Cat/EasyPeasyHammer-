// byanca
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { findDmxConvert } = require('./vmap-dmx-bridge');
const { parseVmdl, parseKeyValues2 } = require('./map-local-model-service-v19');

const sourceCache = new Map();
const sourcePromises = new Map();
const geometryCache = new Map();
const geometryPromises = new Map();
const MAX_SOURCE_CACHE = 12;
const MAX_GEOMETRY_CACHE = 256;
let sourceQueue = Promise.resolve();

function normalizeResource(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function safeProjectFile(vmapPath, resourcePath) {
  try {
    if (!vmapPath || !resourcePath) return null;
    const root = path.resolve(path.dirname(String(vmapPath)));
    const relative = normalizeResource(resourcePath);
    if (!relative || path.isAbsolute(relative) || relative.includes('\0')) return null;
    const candidate = path.resolve(root, ...relative.split('/'));
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (candidate !== root && !candidate.toLowerCase().startsWith(prefix.toLowerCase())) return null;
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function cacheSet(map, key, value, limit) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
  return value;
}

function field(element, key) {
  return element?.fields?.find(item => item.key === key) || null;
}

function resolveElement(document, value) {
  if (!value) return null;
  if (value.kind === 'element') return value;
  if (value.kind === 'reference') return document.byId.get(String(value.id)) || null;
  if (typeof value === 'string') return document.byId.get(value) || null;
  return null;
}

function resolveArray(document, value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => resolveElement(document, item)).filter(Boolean);
}

function numbers(value, size) {
  const values = String(value || '').trim().split(/[\s,]+/).map(Number);
  if (size && values.length < size) return null;
  return values.every(Number.isFinite) ? values : null;
}

function arrayNumbers(value) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function vectorArray(value, width) {
  if (!Array.isArray(value)) return [];
  return value.map(item => numbers(item, width)).filter(Boolean).map(item => item.slice(0, width));
}

function materialName(document, faceSet) {
  const material = resolveElement(document, field(faceSet, 'material')?.value);
  return String(field(material, 'mtlName')?.value || field(material, 'name')?.value || 'ERROR');
}

function splitFaces(values) {
  const output = [];
  let current = [];
  for (const raw of values || []) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (value === -1) {
      if (current.length >= 3) output.push(current);
      current = [];
    } else current.push(value);
  }
  if (current.length >= 3) output.push(current);
  return output;
}

function meshGeometry(document, mesh) {
  let vertexData = resolveElement(document, field(mesh, 'bindState')?.value);
  if (!vertexData || vertexData.className !== 'DmeVertexData') {
    vertexData = resolveArray(document, field(mesh, 'baseStates')?.value).find(item => item.className === 'DmeVertexData') || null;
  }
  if (!vertexData) return null;

  const positions = vectorArray(field(vertexData, 'position$0')?.value, 3);
  const positionIndices = arrayNumbers(field(vertexData, 'position$0Indices')?.value);
  const uvs = vectorArray(field(vertexData, 'texcoord$0')?.value, 2);
  const uvIndices = arrayNumbers(field(vertexData, 'texcoord$0Indices')?.value);
  const normals = vectorArray(field(vertexData, 'normal$0')?.value, 3);
  const normalIndices = arrayNumbers(field(vertexData, 'normal$0Indices')?.value);
  if (!positions.length) return null;

  const outPositions = [];
  const outUvs = [];
  const outNormals = [];
  const groups = [];
  let cursor = 0;

  for (const faceSet of resolveArray(document, field(mesh, 'faceSets')?.value)) {
    const material = materialName(document, faceSet);
    const start = cursor;
    for (const polygon of splitFaces(field(faceSet, 'faces')?.value)) {
      for (let triangle = 1; triangle < polygon.length - 1; triangle++) {
        for (const corner of [polygon[0], polygon[triangle], polygon[triangle + 1]]) {
          const pi = positionIndices.length ? positionIndices[corner] : corner;
          const uvI = uvIndices.length ? uvIndices[corner] : corner;
          const ni = normalIndices.length ? normalIndices[corner] : corner;
          const p = positions[pi] || [0, 0, 0];
          const uv = uvs[uvI] || [0, 0];
          const n = normals[ni] || [0, 0, 1];
          outPositions.push(p[0], p[1], p[2]);
          outUvs.push(uv[0], uv[1]);
          outNormals.push(n[0], n[1], n[2]);
          cursor++;
        }
      }
    }
    if (cursor > start) groups.push({ start, count: cursor - start, material });
  }

  if (!outPositions.length) return null;
  return {
    name: String(field(mesh, 'name')?.value || 'mesh'),
    positions: outPositions,
    uvs: outUvs,
    normals: outNormals,
    groups,
  };
}

function collectMeshes(document) {
  const byName = new Map();
  const seen = new Set();
  const visit = element => {
    if (!element || seen.has(element)) return;
    seen.add(element);
    if (element.className === 'DmeMesh') {
      const name = String(field(element, 'name')?.value || '');
      if (name && !byName.has(name)) byName.set(name, element);
    }
    for (const item of element.fields || []) {
      const direct = resolveElement(document, item.value);
      if (direct) visit(direct);
      if (Array.isArray(item.value)) for (const value of item.value) {
        const child = resolveElement(document, value);
        if (child) visit(child);
      }
    }
  };
  document.elements.forEach(visit);
  return byName;
}

function runConvert(executable, input, output, extraArgs) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', child;
    try {
      child = spawn(executable, ['-i', input, '-o', output, ...extraArgs], {
        cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { if (stdout.length < 262144) stdout += chunk; });
    child.stderr?.on('data', chunk => { if (stderr.length < 262144) stderr += chunk; });
    child.on('error', error => resolve({ ok: false, error: error.message }));
    child.on('close', code => resolve({
      ok: code === 0 && fs.existsSync(output),
      code,
      error: code === 0 ? '' : (stderr.trim() || stdout.trim() || `dmxconvert exited with code ${code}`),
    }));
  });
}

function enqueueSource(task) {
  const run = sourceQueue.then(task, task);
  sourceQueue = run.catch(() => {});
  return run;
}

function sourceKey(sourceDmx) {
  const stat = fs.statSync(sourceDmx);
  return `${sourceDmx.toLowerCase()}|${stat.size}|${stat.mtimeMs}`;
}

async function convertedSource(app, sourceDmx) {
  const key = sourceKey(sourceDmx);
  if (sourceCache.has(key)) {
    const value = sourceCache.get(key);
    sourceCache.delete(key);
    sourceCache.set(key, value);
    return value;
  }
  if (sourcePromises.has(key)) return sourcePromises.get(key);

  const promise = enqueueSource(async () => {
    if (sourceCache.has(key)) return sourceCache.get(key);
    const started = Date.now();
    const tool = findDmxConvert();
    if (!tool?.executable) throw new Error('CS2 dmxconvert.exe was not found for map-local source model decoding.');

    const cacheRoot = path.join(app.getPath('userData'), 'MapSourceCache');
    fs.mkdirSync(cacheRoot, { recursive: true });
    const hash = crypto.createHash('sha1').update(key).digest('hex');
    const converted = path.join(cacheRoot, `${hash}.model.dmx`);

    if (!fs.existsSync(converted)) {
      const temp = `${converted}.${process.pid}.tmp`;
      try { fs.rmSync(temp, { force: true }); } catch {}
      let result = await runConvert(tool.executable, sourceDmx, temp, ['-ie', 'binary', '-oe', 'keyvalues2', '-of', 'model']);
      if (!result.ok) result = await runConvert(tool.executable, sourceDmx, temp, ['-oe', 'keyvalues2', '-of', 'model']);
      if (!result.ok) {
        try { fs.rmSync(temp, { force: true }); } catch {}
        throw new Error(`Could not decode map-local model DMX: ${result.error}`);
      }
      try { fs.renameSync(temp, converted); }
      catch {
        if (!fs.existsSync(converted)) fs.copyFileSync(temp, converted);
        fs.rmSync(temp, { force: true });
      }
    }

    const text = await fs.promises.readFile(converted, 'utf8');
    const document = parseKeyValues2(text);
    const meshesByName = collectMeshes(document);
    const value = { document, meshesByName, key };
    cacheSet(sourceCache, key, value, MAX_SOURCE_CACHE);
    globalThis.__ephAppLog?.('normal', 'map-local-model', 'Prepared shared map-local meshset once.', {
      source: sourceDmx,
      draws: meshesByName.size,
      elapsedMs: Date.now() - started,
      cachedConversion: fs.existsSync(converted),
    });
    return value;
  }).finally(() => sourcePromises.delete(key));

  sourcePromises.set(key, promise);
  return promise;
}

function geometryDiskPath(app, key) {
  const root = path.join(app.getPath('userData'), 'MapSourceCache', 'geometry-v20');
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);
}

async function readGeometryDisk(app, key) {
  const file = geometryDiskPath(app, key);
  try {
    const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    if (parsed?.version === 20 && parsed?.result?.ok) return parsed.result;
  } catch {}
  return null;
}

function writeGeometryDisk(app, key, result) {
  const file = geometryDiskPath(app, key);
  const temp = `${file}.${process.pid}.tmp`;
  setImmediate(async () => {
    try {
      const text = JSON.stringify({ version: 20, result });
      await fs.promises.writeFile(temp, text, 'utf8');
      try { await fs.promises.rename(temp, file); }
      catch {
        await fs.promises.copyFile(temp, file);
        await fs.promises.rm(temp, { force: true });
      }
    } catch {
      try { await fs.promises.rm(temp, { force: true }); } catch {}
    }
  });
}

async function loadMapLocalModelV20(app, vmapPath, resourcePath) {
  const normalized = normalizeResource(resourcePath);
  const vmdlPath = safeProjectFile(vmapPath, normalized);
  if (!vmdlPath || path.extname(vmdlPath).toLowerCase() !== '.vmdl') return { ok: false, local: false, error: 'Map-local VMDL was not found.' };

  const descriptor = parseVmdl(vmdlPath);
  if (!descriptor.meshFiles.length) return { ok: false, local: true, error: 'Map-local VMDL has no RenderMeshFile.' };

  const sourceInfo = [];
  for (const meshResource of descriptor.meshFiles) {
    const dmxPath = safeProjectFile(vmapPath, meshResource);
    if (!dmxPath) continue;
    sourceInfo.push({ meshResource, dmxPath, key: sourceKey(dmxPath) });
  }
  if (!sourceInfo.length) return { ok: false, local: true, error: 'Referenced map-local model DMX is missing.' };

  const vmdlStat = fs.statSync(vmdlPath);
  const key = [vmdlPath.toLowerCase(), vmdlStat.size, vmdlStat.mtimeMs, ...sourceInfo.map(item => item.key), ...descriptor.drawNames].join('|');
  if (geometryCache.has(key)) return { ...geometryCache.get(key), cached: true };
  if (geometryPromises.has(key)) return geometryPromises.get(key);

  const promise = (async () => {
    const disk = await readGeometryDisk(app, key);
    if (disk) {
      cacheSet(geometryCache, key, disk, MAX_GEOMETRY_CACHE);
      return { ...disk, cached: true, cacheSource: 'disk' };
    }

    const projectRoot = path.dirname(path.resolve(vmapPath));
    const requested = new Set(descriptor.drawNames.map(String));
    const meshes = [];
    const sourceFiles = [];
    const started = Date.now();

    for (const info of sourceInfo) {
      sourceFiles.push(path.relative(projectRoot, info.dmxPath).replace(/\\/g, '/'));
      const source = await convertedSource(app, info.dmxPath);
      if (requested.size) {
        for (const name of requested) {
          const candidate = source.meshesByName.get(name);
          if (!candidate) continue;
          const geometry = meshGeometry(source.document, candidate);
          if (geometry) meshes.push(geometry);
        }
      } else {
        for (const candidate of source.meshesByName.values()) {
          const geometry = meshGeometry(source.document, candidate);
          if (geometry) meshes.push(geometry);
        }
      }
      await new Promise(resolve => setImmediate(resolve));
    }

    if (!meshes.length) {
      return {
        ok: false,
        local: true,
        error: descriptor.drawNames.length ? `No requested draw mesh (${descriptor.drawNames.join(', ')}) was found in the local DMX.` : 'No renderable DmeMesh was found in the local DMX.',
      };
    }

    const result = {
      ok: true,
      local: true,
      resource: normalized,
      source: path.relative(projectRoot, vmdlPath).replace(/\\/g, '/'),
      sourceFiles,
      drawNames: descriptor.drawNames,
      translation: descriptor.translation,
      meshes,
    };
    cacheSet(geometryCache, key, result, MAX_GEOMETRY_CACHE);
    writeGeometryDisk(app, key, result);
    globalThis.__ephAppLog?.('normal', 'map-local-model', 'Decoded map-local source model from shared meshset cache.', {
      resource: normalized,
      draws: descriptor.drawNames,
      meshes: meshes.length,
      vertices: meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0),
      elapsedMs: Date.now() - started,
    });
    return result;
  })().finally(() => geometryPromises.delete(key));

  geometryPromises.set(key, promise);
  return promise;
}

function registerMapLocalModelServiceV20({ ipcMain, app }) {
  if (globalThis.__ephMapLocalModelServiceV20) return;
  globalThis.__ephMapLocalModelServiceV20 = true;
  ipcMain.handle('map-local:model', (_event, vmapPath, resourcePath) => loadMapLocalModelV20(app, vmapPath, resourcePath));
}

module.exports = { registerMapLocalModelServiceV20, loadMapLocalModelV20 };
