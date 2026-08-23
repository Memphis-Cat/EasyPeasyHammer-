// byanca
'use strict';

const HEADER_RE = /<!--\s*dmx\s+encoding\s+keyvalues2\s+(\d+)\s+format\s+vmap\s+(\d+)\s*-->/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '<' && text.slice(i, i + 4) === '<!--') {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) throw new Error('Unterminated VMAP comment/header.');
      i = end + 3;
      continue;
    }
    if ('{}[],'.includes(c)) { out.push({ type: c, value: c }); i++; continue; }
    if (c === '"') {
      i++;
      let value = '';
      let closed = false;
      while (i < text.length) {
        const x = text[i++];
        if (x === '"') { closed = true; break; }
        if (x === '\\' && i < text.length) {
          const y = text[i++];
          value += y === 'n' ? '\n' : y === 'r' ? '\r' : y === 't' ? '\t' : y;
        } else value += x;
      }
      if (!closed) throw new Error('Unterminated quoted VMAP string.');
      out.push({ type: 'string', value });
      continue;
    }
    const start = i;
    while (i < text.length && !/\s/.test(text[i]) && !'{}[],'.includes(text[i])) i++;
    out.push({ type: 'string', value: text.slice(start, i) });
  }
  return out;
}

function parseVmapText(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const headerMatch = source.match(HEADER_RE);
  if (!headerMatch) throw new Error('Missing DMX keyvalues2 VMAP header.');
  if (Number(headerMatch[1]) !== 4) throw new Error(`Unsupported keyvalues2 encoding version ${headerMatch[1]}.`);
  const formatVersion = Number(headerMatch[2]);
  if (!Number.isInteger(formatVersion) || formatVersion < 1) throw new Error('Invalid VMAP format version.');

  const tokens = tokenize(source);
  let index = 0;
  const peek = () => tokens[index] || null;
  const take = expected => {
    const token = tokens[index++];
    if (!token) throw new Error('Unexpected end of VMAP text.');
    if (expected && token.type !== expected) throw new Error(`Expected ${expected} but found ${token.type}.`);
    return token;
  };

  const parseArray = () => {
    take('[');
    const values = [];
    while (peek() && peek().type !== ']') {
      if (peek().type === ',') { take(','); continue; }
      const first = take('string').value;
      if (peek()?.type === '{') values.push(parseElement(first));
      else values.push(first);
    }
    take(']');
    return values;
  };

  const parseElement = className => {
    take('{');
    const fields = [];
    while (peek() && peek().type !== '}') {
      if (peek().type === ',') { take(','); continue; }
      const key = take('string').value;
      const fieldType = take('string').value;
      let value;
      if (peek()?.type === '{') value = parseElement(fieldType);
      else if (peek()?.type === '[') value = parseArray();
      else value = take('string').value;
      fields.push({ key, type: fieldType, value });
    }
    take('}');
    return { kind: 'element', className, fields };
  };

  const elements = [];
  while (peek()) {
    if (peek().type === ',') { take(','); continue; }
    const className = take('string').value;
    if (peek()?.type !== '{') throw new Error(`Expected element body after ${className}.`);
    elements.push(parseElement(className));
  }
  return { header: headerMatch[0], formatVersion, elements };
}

const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
const get = (element, key, fallback = null) => field(element, key)?.value ?? fallback;
const elem = (element, key) => get(element, key)?.kind === 'element' ? get(element, key) : null;
const ary = (element, key) => Array.isArray(get(element, key)) ? get(element, key) : [];

function walk(element, callback) {
  if (!element?.kind) return;
  callback(element);
  for (const item of element.fields || []) {
    if (Array.isArray(item.value)) item.value.forEach(value => value?.kind && walk(value, callback));
    else if (item.value?.kind) walk(item.value, callback);
  }
}

function validateVmapText(text) {
  const errors = [];
  const warnings = [];
  let doc;
  try {
    if (typeof text !== 'string' && !Buffer.isBuffer(text)) throw new Error('VMAP data must be text.');
    const source = Buffer.isBuffer(text) ? text.toString('utf8') : text;
    if (!source.trim()) throw new Error('VMAP data is empty.');
    if (source.includes('\0')) throw new Error('VMAP text contains NUL bytes.');
    doc = parseVmapText(source);
  } catch (error) {
    return { ok: false, errors: [error.message], warnings, doc: null };
  }

  const roots = doc.elements.filter(element => element.className === 'CMapRootElement');
  if (roots.length !== 1) errors.push(`Expected exactly one CMapRootElement, found ${roots.length}.`);
  const root = roots[0] || null;
  const ids = new Map();
  for (const top of doc.elements) {
    walk(top, element => {
      const id = String(get(element, 'id', ''));
      if (!id) return;
      if (ids.has(id) && ids.get(id) !== element) errors.push(`Duplicate elementid ${id}.`);
      else ids.set(id, element);
      if (!UUID_RE.test(id)) warnings.push(`${element.className} uses non-standard elementid ${id}.`);
    });
  }

  const resolve = value => value?.kind === 'element' ? value : typeof value === 'string' ? ids.get(value) || null : null;
  const world = root ? resolve(get(root, 'world')) : null;
  if (!world || world.className !== 'CMapWorld') errors.push('CMapRootElement.world is missing or does not resolve to CMapWorld.');
  if (world && !Array.isArray(get(world, 'children'))) errors.push('CMapWorld.children is missing or is not an element_array.');

  for (const top of doc.elements) {
    walk(top, element => {
      for (const item of element.fields || []) {
        if (item.type === 'element_array' && Array.isArray(item.value)) {
          for (const value of item.value) {
            if (typeof value === 'string' && UUID_RE.test(value) && !ids.has(value)) errors.push(`${element.className}.${item.key} references missing element ${value}.`);
          }
        } else if (typeof item.value === 'string' && UUID_RE.test(item.value) && (item.type === 'element' || /^C[A-Z]/.test(item.type)) && !ids.has(item.value)) {
          errors.push(`${element.className}.${item.key} references missing element ${item.value}.`);
        }
      }

      if (element.className !== 'CMapMesh') return;
      const meshData = resolve(get(element, 'meshData')) || elem(element, 'meshData');
      if (!meshData || meshData.className !== 'CDmePolygonMesh') {
        errors.push(`CMapMesh ${get(element, 'nodeID', '?')} has no CDmePolygonMesh meshData.`);
        return;
      }
      const edgeVertex = ary(meshData, 'edgeVertexIndices');
      const edgeCount = edgeVertex.length;
      for (const key of ['edgeOppositeIndices', 'edgeNextIndices', 'edgeFaceIndices', 'edgeDataIndices', 'edgeVertexDataIndices']) {
        if (ary(meshData, key).length !== edgeCount) errors.push(`CMapMesh ${get(element, 'nodeID', '?')} ${key} length does not match half-edge count.`);
      }
      if (ary(meshData, 'faceEdgeIndices').length !== ary(meshData, 'faceDataIndices').length) errors.push(`CMapMesh ${get(element, 'nodeID', '?')} face index arrays have different lengths.`);
      const subdivision = resolve(get(meshData, 'subdivisionData')) || elem(meshData, 'subdivisionData');
      if (subdivision) {
        const levels = ary(subdivision, 'subdivisionLevels');
        if (levels.length !== edgeCount) errors.push(`CMapMesh ${get(element, 'nodeID', '?')} subdivisionLevels has ${levels.length} rows but half-edge count is ${edgeCount}.`);
      }
    });
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], doc };
}

function assertValidVmapText(text) {
  const result = validateVmapText(text);
  if (!result.ok) throw new Error(`VMAP preflight failed: ${result.errors.join(' ')}`);
  return result;
}

module.exports = { parseVmapText, validateVmapText, assertValidVmapText };
