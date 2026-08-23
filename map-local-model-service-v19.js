// byanca
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { findDmxConvert } = require('./vmap-dmx-bridge');

const documentCache = new Map();
const geometryCache = new Map();
const MAX_DOCUMENT_CACHE = 6;
const MAX_GEOMETRY_CACHE = 160;

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
    const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (candidate !== root && !candidate.toLowerCase().startsWith(rootPrefix.toLowerCase())) return null;
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function parseVmdl(vmdlPath) {
  const text = fs.readFileSync(vmdlPath, 'utf8');
  const meshMatches = [...text.matchAll(/\bfilename\s*=\s*"([^"]+\.dmx)"/gi)].map(match => normalizeResource(match[1]));
  const exceptions = [];
  for (const block of text.matchAll(/\bexception_list\s*=\s*\[([\s\S]*?)\]/gi)) {
    for (const item of block[1].matchAll(/"([^"]+)"/g)) exceptions.push(item[1]);
  }
  const translationMatch = text.match(/\btranslation\s*=\s*\[\s*(-?[\d.eE+]+)\s*,?\s*(-?[\d.eE+]+)\s*,?\s*(-?[\d.eE+]+)\s*\]/i);
  const translation = translationMatch ? translationMatch.slice(1, 4).map(Number) : [0, 0, 0];
  return { meshFiles: [...new Set(meshMatches)], drawNames: [...new Set(exceptions)], translation };
}

function tokenise(text) {
  const output = [];
  let index = 0;
  const source = String(text || '');
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    if (char === '<' && source.slice(index, index + 4) === '<!--') {
      const end = source.indexOf('-->', index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if ('{}[],'.includes(char)) { output.push({ type: char, value: char }); index++; continue; }
    if (char === '"') {
      index++;
      let value = '';
      while (index < source.length) {
        const current = source[index++];
        if (current === '"') break;
        if (current === '\\' && index < source.length) {
          const next = source[index++];
          value += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next;
        } else value += current;
      }
      output.push({ type: 'string', value });
      continue;
    }
    const start = index;
    while (index < source.length && !/\s/.test(source[index]) && !'{}[],'.includes(source[index])) index++;
    output.push({ type: 'string', value: source.slice(start, index) });
  }
  return output;
}

function parseKeyValues2(text) {
  const tokens = tokenise(text);
  let cursor = 0;
  const peek = () => tokens[cursor] || null;
  const take = expected => {
    const token = tokens[cursor++];
    if (!token) throw new Error('Unexpected end of model DMX.');
    if (expected && token.type !== expected) throw new Error(`Expected ${expected}, got ${token.type}.`);
    return token;
  };

  function parseArray(fieldType) {
    take('[');
    const values = [];
    while (peek() && peek().type !== ']') {
      if (peek().type === ',') { take(','); continue; }
      const first = take('string').value;
      if (peek()?.type === '{') {
        values.push(parseElement(first));
        continue;
      }
      if (fieldType === 'element_array' && first === 'element' && peek()?.type === 'string') {
        values.push({ kind: 'reference', id: take('string').value });
        continue;
      }
      values.push(first);
    }
    take(']');
    return values;
  }

  function parseElement(className) {
    take('{');
    const fields = [];
    while (peek() && peek().type !== '}') {
      if (peek().type === ',') { take(','); continue; }
      const key = take('string').value;
      const type = take('string').value;
      let value;
      if (peek()?.type === '{') value = parseElement(type);
      else if (peek()?.type === '[') value = parseArray(type);
      else value = take('string').value;
      fields.push({ key, type, value });
    }
    take('}');
    return { kind: 'element', className, fields };
  }

  const elements = [];
  while (peek()) {
    if (peek().type === ',') { take(','); continue; }
    const className = take('string').value;
    if (peek()?.type !== '{') throw new Error(`Expected model element body after ${className}.`);
    elements.push(parseElement(className));
  }

  const byId = new Map();
  const visit = element => {
    if (!element?.fields) return;
    const id = element.fields.find(field => field.key === 'id')?.value;
    if (typeof id === 'string' && id) byId.set(id, element);
    for (const field of element.fields) {
      if (field.value?.kind === 'element') visit(field.value);
      else if (Array.isArray(field.value)) for (const child of field.value) if (child?.kind === 'element') visit(child);
    }
  };
  elements.forEach(visit);
  return { elements, byId };
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

function arrayNumbers(fieldValue) {
  return Array.isArray(fieldValue) ? fieldValue.map(Number).filter(Number.isFinite) : [];
}

function vectorArray(fieldValue, width) {
  if (!Array.isArray(fieldValue)) return [];
  return fieldValue.map(value => numbers(value, width)).filter(Boolean).map(value => value.slice(0, width));
}

function materialName(document, faceSet) {
  const material = resolveElement(document, field(faceSet, 'material')?.value);
  return String(field(material, 'mtlName')?.value || field(material, 'name')?.value || 'ERROR');
}

function splitFaces(values) {
  const output = [];
  let current = [];
  for (const value of values) {
    const index = Number(value);
    if (!Number.isFinite(index)) continue;
    if (index === -1) {
      if (current.length >= 3) output.push(current);
      current = [];
    } else current.push(index);
  }
  if (current.length >= 3) output.push(current);
  return output;
}

function meshGeometry(document, mesh) {
  let vertexData = resolveElement(document, field(mesh, 'bindState')?.value);
  if (!vertexData || vertexData.className !== 'DmeVertexData') {
    vertexData = resolveArray(document, field(mesh, 'baseStates')?.value).find(element => element.className === 'DmeVertexData') || null;
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
  let vertexCursor = 0;

  const faceSets = resolveArray(document, field(mesh, 'faceSets')?.value);
  for (const faceSet of faceSets) {
    const material = materialName(document, faceSet);
    const polygons = splitFaces(field(faceSet, 'faces')?.value || []);
    const start = vertexCursor;
    for (const polygon of polygons) {
      for (let triangle = 1; triangle < polygon.length - 1; triangle++) {
        for (const corner of [polygon[0], polygon[triangle], polygon[triangle + 1]]) {
          const positionIndex = positionIndices.length ? positionIndices[corner] : corner;
          const position = positions[positionIndex] || [0, 0, 0];
          outPositions.push(position[0], position[1], position[2]);

          const uvIndex = uvIndices.length ? uvIndices[corner] : corner;
          const uv = uvs[uvIndex] || [0, 0];
          outUvs.push(uv[0], uv[1]);

          const normalIndex = normalIndices.length ? normalIndices[corner] : corner;
          const normal = normals[normalIndex] || [0, 0, 1];
          outNormals.push(normal[0], normal[1], normal[2]);
          vertexCursor++;
        }
      }
    }
    if (vertexCursor > start) groups.push({ start, count: vertexCursor - start, material });
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

function collectElements(document, className) {
  const output = [];
  const seen = new Set();
  const visit = element => {
    if (!element || seen.has(element)) return;
    seen.add(element);
    if (element.className === className) output.push(element);
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
  return output;
}

function cacheSet(map, key, value, limit) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
  return value;
}

function runConvert(executable, input, output, extraArgs) {
  return new Promise(resolve => {
    let stderr = '', stdout = '';
    let child;
    try {
      child = spawn(executable, ['-i', input, '-o', output, ...extraArgs], { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { if (stdout.length < 262144) stdout += chunk; });
    child.stderr?.on('data', chunk => { if (stderr.length < 262144) stderr += chunk; });
    child.on('error', error => resolve({ ok: false, error: error.message }));
    child.on('close', code => resolve({ ok: code === 0 && fs.existsSync(output), code, error: code === 0 ? '' : (stderr.trim() || stdout.trim() || `dmxconvert exited with code ${code}`) }));
  });
}

async function convertedDocument(app, sourceDmx) {
  const stat = fs.statSync(sourceDmx);
  const cacheKey = `${sourceDmx.toLowerCase()}|${stat.size}|${stat.mtimeMs}`;
  if (documentCache.has(cacheKey)) {
    const value = documentCache.get(cacheKey);
    documentCache.delete(cacheKey);
    documentCache.set(cacheKey, value);
    return value;
  }

  const tool = findDmxConvert();
  if (!tool?.executable) throw new Error('CS2 dmxconvert.exe was not found for map-local source model decoding.');
  const cacheRoot = path.join(app.getPath('userData'), 'MapSourceCache');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const hash = crypto.createHash('sha1').update(cacheKey).digest('hex');
  const converted = path.join(cacheRoot, `${hash}.model.dmx`);

  if (!fs.existsSync(converted)) {
    const temp = `${converted}.tmp`;
    let result = await runConvert(tool.executable, sourceDmx, temp, ['-ie', 'binary', '-oe', 'keyvalues2', '-of', 'model']);
    if (!result.ok) result = await runConvert(tool.executable, sourceDmx, temp, ['-oe', 'keyvalues2', '-of', 'model']);
    if (!result.ok) {
      try { fs.rmSync(temp, { force: true }); } catch {}
      throw new Error(`Could not decode map-local model DMX: ${result.error}`);
    }
    try { fs.renameSync(temp, converted); }
    catch { fs.copyFileSync(temp, converted); fs.rmSync(temp, { force: true }); }
  }

  const document = parseKeyValues2(fs.readFileSync(converted, 'utf8'));
  cacheSet(documentCache, cacheKey, document, MAX_DOCUMENT_CACHE);
  return document;
}

async function loadMapLocalModel(app, vmapPath, resourcePath) {
  const normalized = normalizeResource(resourcePath);
  const vmdlPath = safeProjectFile(vmapPath, normalized);
  if (!vmdlPath || path.extname(vmdlPath).toLowerCase() !== '.vmdl') return { ok: false, local: false, error: 'Map-local VMDL was not found.' };

  const stat = fs.statSync(vmdlPath);
  const cacheKey = `${vmdlPath.toLowerCase()}|${stat.size}|${stat.mtimeMs}`;
  if (geometryCache.has(cacheKey)) {
    const value = geometryCache.get(cacheKey);
    geometryCache.delete(cacheKey);
    geometryCache.set(cacheKey, value);
    return { ...value, cached: true };
  }

  const descriptor = parseVmdl(vmdlPath);
  if (!descriptor.meshFiles.length) return { ok: false, local: true, error: 'Map-local VMDL has no RenderMeshFile.' };

  const projectRoot = path.dirname(path.resolve(vmapPath));
  const requested = new Set(descriptor.drawNames.map(String));
  const meshes = [];
  const sourceFiles = [];

  for (const meshResource of descriptor.meshFiles) {
    const dmxPath = safeProjectFile(vmapPath, meshResource);
    if (!dmxPath) {
      globalThis.__ephAppLog?.('warning', 'map-local-model', 'Referenced map-local DMX is missing.', { model: normalized, meshResource });
      continue;
    }
    sourceFiles.push(path.relative(projectRoot, dmxPath).replace(/\\/g, '/'));
    const document = await convertedDocument(app, dmxPath);
    const candidates = collectElements(document, 'DmeMesh');
    for (const candidate of candidates) {
      const name = String(field(candidate, 'name')?.value || '');
      if (requested.size && !requested.has(name)) continue;
      const geometry = meshGeometry(document, candidate);
      if (geometry) meshes.push(geometry);
    }
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
  cacheSet(geometryCache, cacheKey, result, MAX_GEOMETRY_CACHE);
  globalThis.__ephAppLog?.('normal', 'map-local-model', 'Decoded map-local source model.', {
    resource: normalized,
    draws: descriptor.drawNames,
    meshes: meshes.length,
    vertices: meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0),
  });
  return result;
}

function registerMapLocalModelServiceV19({ ipcMain, app }) {
  if (globalThis.__ephMapLocalModelServiceV19) return;
  globalThis.__ephMapLocalModelServiceV19 = true;
  ipcMain.handle('map-local:model', (_event, vmapPath, resourcePath) => loadMapLocalModel(app, vmapPath, resourcePath));
}

module.exports = { registerMapLocalModelServiceV19, loadMapLocalModel, parseVmdl, parseKeyValues2 };
