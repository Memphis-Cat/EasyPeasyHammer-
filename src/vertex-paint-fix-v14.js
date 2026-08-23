// byanca
(() => {
  'use strict';

  if (window.__ephVertexPaintFixV14) return;
  window.__ephVertexPaintFixV14 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const BLEND_STREAM = 'VertexPaintBlendParams:0';
  const TINT_STREAM = 'VertexPaintTintColor:0';

  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const elem = (element, key) => {
    const value = field(element, key)?.value;
    return value?.kind === 'element' ? value : null;
  };
  const ary = (element, key) => Array.isArray(field(element, key)?.value) ? field(element, key).value : [];
  const vector4 = value => {
    const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
    return Array.from({ length: 4 }, (_, index) => Number.isFinite(Number(source[index])) ? Number(source[index]) : 0);
  };
  const vector4String = value => vector4(value).map(number => {
    const clean = Math.abs(number) < 1e-8 ? 0 : number;
    return Number.isInteger(clean) ? String(clean) : String(Number(clean.toFixed(6)));
  }).join(' ');
  const uid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16 | 0) & (c === 'x' ? 15 : 3) | (c === 'y' ? 8 : 0)).toString(16));

  function findElement(doc, dmxId) {
    if (typeof VMAP.findElementByDmxId === 'function') return VMAP.findElementByDmxId(doc, dmxId);
    let found = null;
    const walk = element => {
      if (!element?.kind || found) return;
      if (String(field(element, 'id')?.value || '') === String(dmxId)) { found = element; return; }
      for (const item of element.fields || []) {
        if (Array.isArray(item.value)) item.value.forEach(value => value?.kind && walk(value));
        else if (item.value?.kind) walk(item.value);
      }
    };
    for (const element of doc?.elements || []) walk(element);
    return found;
  }

  function stream(dataArray, name) {
    return ary(dataArray, 'streams').find(item => item?.kind === 'element' && String(field(item, 'name')?.value || '') === name) || null;
  }

  function ensureStream(dataArray, name) {
    if (!dataArray) return null;
    let result = stream(dataArray, name);
    const size = Math.max(0, Number(field(dataArray, 'size')?.value) || 0);
    if (!result) {
      const semantic = name.replace(/:0$/, '');
      result = {
        kind: 'element',
        className: 'CDmePolygonMeshDataStream',
        fields: [
          { key: 'id', type: 'elementid', value: uid() },
          { key: 'name', type: 'string', value: name },
          { key: 'standardAttributeName', type: 'string', value: semantic },
          { key: 'semanticName', type: 'string', value: semantic },
          { key: 'semanticIndex', type: 'int', value: '0' },
          { key: 'vertexBufferLocation', type: 'int', value: '0' },
          { key: 'dataStateFlags', type: 'int', value: '1' },
          { key: 'subdivisionBinding', type: 'element', value: '' },
          { key: 'data', type: 'vector4_array', value: Array(size).fill('0 0 0 0') },
        ],
      };
      let streams = field(dataArray, 'streams');
      if (!streams) {
        streams = { key: 'streams', type: 'element_array', value: [] };
        dataArray.fields.push(streams);
      }
      if (!Array.isArray(streams.value)) streams.value = [];
      streams.value.push(result);
    }
    const data = field(result, 'data');
    if (data) {
      if (!Array.isArray(data.value)) data.value = [];
      while (data.value.length < size) data.value.push('0 0 0 0');
    }
    return result;
  }

  function hasPaint(object) {
    return Array.isArray(object?.vertexPaintBlendParams) || Array.isArray(object?.vertexPaintTintColor);
  }

  function writePaint(doc, object) {
    if (!doc || !object?.dmxId || !hasPaint(object)) return false;
    const element = findElement(doc, object.dmxId);
    const meshData = elem(element, 'meshData');
    const faceVertexData = elem(meshData, 'faceVertexData');
    if (!meshData || !faceVertexData) return false;

    const edgeVertex = ary(meshData, 'edgeVertexIndices').map(Number);
    const edgeRows = ary(meshData, 'edgeVertexDataIndices').map(Number);
    let wrote = false;

    for (const [name, objectKey] of [[BLEND_STREAM, 'vertexPaintBlendParams'], [TINT_STREAM, 'vertexPaintTintColor']]) {
      if (!Array.isArray(object[objectKey])) continue;
      const target = ensureStream(faceVertexData, name);
      const data = field(target, 'data')?.value;
      if (!Array.isArray(data)) continue;
      for (let edge = 0; edge < edgeVertex.length; edge++) {
        const vertex = edgeVertex[edge];
        const row = edgeRows[edge];
        if (vertex < 0 || vertex >= object[objectKey].length || row < 0) continue;
        while (data.length <= row) data.push('0 0 0 0');
        data[row] = vector4String(object[objectKey][vertex]);
        wrote = true;
      }
    }
    return wrote;
  }

  if (!VMAP.applyObjectToDocument.__ephPaintPreserveV14) {
    const rawApply = VMAP.applyObjectToDocument.bind(VMAP);
    const wrappedApply = function(doc, object) {
      const result = rawApply(doc, object);
      if (result !== false && hasPaint(object)) writePaint(doc, object);
      return result;
    };
    wrappedApply.__ephPaintPreserveV14 = true;
    wrappedApply.__ephPreviousApply = rawApply;
    VMAP.applyObjectToDocument = wrappedApply;
  }

  if (!VMAP.prepareForSave.__ephPaintPreserveV14) {
    const rawPrepare = VMAP.prepareForSave.bind(VMAP);
    const wrappedPrepare = function(doc, objects) {
      const output = rawPrepare(doc, objects);
      for (const object of objects || []) if (hasPaint(object)) writePaint(output, object);
      return output;
    };
    wrappedPrepare.__ephPaintPreserveV14 = true;
    wrappedPrepare.__ephPreviousPrepare = rawPrepare;
    VMAP.prepareForSave = wrappedPrepare;
  }

  function injectUsageHint() {
    const object = typeof current === 'function' ? current() : null;
    const section = document.querySelector('.eph-vertex-paint-section');
    if (!section || !object || !['part', 'terrain'].includes(object.type)) return;
    let hint = section.querySelector('.eph-vertex-paint-v14-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'selection-info eph-vertex-paint-v14-hint';
      section.appendChild(hint);
    }
    const count = object.vertices?.length || 0;
    const bounds = VMAP.geometryBounds?.(object.vertices || []);
    const largest = Math.max(...(bounds?.size || [0]));
    if (count <= 8) {
      hint.textContent = `This Part only has ${count} vertices. Vertex Paint changes those vertices, so a brush in the middle of a large face may touch nothing. Increase Radius until it reaches a corner/vertex. For local detailed blends, use a subdivided mesh or Terrain.`;
    } else {
      hint.textContent = `This mesh has ${count} vertices. Brush Radius is measured in local world units${largest ? ` (largest dimension ≈ ${Math.round(largest)}u)` : ''}. Orange/tinted dots show which vertices carry paint.`;
    }
  }

  if (typeof renderProperties === 'function' && !renderProperties.__ephPaintHintV14) {
    const rawRenderProperties = renderProperties;
    renderProperties = function(...args) {
      const result = rawRenderProperties(...args);
      injectUsageHint();
      return result;
    };
    renderProperties.__ephPaintHintV14 = true;
    window.renderProperties = renderProperties;
  }

  try {
    for (const object of S?.objects || []) if (hasPaint(object)) writePaint(S.doc, object);
    injectUsageHint();
  } catch {}
})();