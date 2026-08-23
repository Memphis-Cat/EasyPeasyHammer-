// byanca
(() => {
  'use strict';

  const PAINT_BLEND_STREAM = 'VertexPaintBlendParams:0';
  const PAINT_TINT_STREAM = 'VertexPaintTintColor:0';
  const FACE_NAMES = ['right', 'left', 'front', 'back', 'top', 'bottom'];
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const paintSettings = {
    mode: localStorage.getItem('eph-vertex-paint-mode') || 'blend',
    channel: Math.max(0, Math.min(3, Number(localStorage.getItem('eph-vertex-paint-channel')) || 0)),
    radius: Math.max(1, Number(localStorage.getItem('eph-vertex-paint-radius')) || 96),
    strength: Math.max(.01, Math.min(1, Number(localStorage.getItem('eph-vertex-paint-strength')) || .28)),
    value: (() => { const stored = localStorage.getItem('eph-vertex-paint-value'); return stored == null ? 1 : Math.max(0, Math.min(1, Number(stored) || 0)); })(),
    tint: localStorage.getItem('eph-vertex-paint-tint') || '#ffffff',
  };

  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const elem = (element, key) => {
    const value = field(element, key)?.value;
    return value?.kind === 'element' ? value : null;
  };
  const ary = (element, key) => Array.isArray(field(element, key)?.value) ? field(element, key).value : [];
  const stream = (dataArray, name) => ary(dataArray, 'streams').find(item => item?.kind === 'element' && String(field(item, 'name')?.value || '') === name) || null;
  const uid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16 | 0) & (c === 'x' ? 15 : 3) | (c === 'y' ? 8 : 0)).toString(16));
  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const vector4 = value => {
    const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
    return Array.from({ length: 4 }, (_, index) => Number.isFinite(Number(source[index])) ? Number(source[index]) : 0);
  };
  const vector4String = value => vector4(value).map(number => {
    const n = Math.abs(number) < 1e-8 ? 0 : number;
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
  }).join(' ');

  function savePaintSettings() {
    localStorage.setItem('eph-vertex-paint-mode', paintSettings.mode);
    localStorage.setItem('eph-vertex-paint-channel', String(paintSettings.channel));
    localStorage.setItem('eph-vertex-paint-radius', String(paintSettings.radius));
    localStorage.setItem('eph-vertex-paint-strength', String(paintSettings.strength));
    localStorage.setItem('eph-vertex-paint-value', String(paintSettings.value));
    localStorage.setItem('eph-vertex-paint-tint', paintSettings.tint);
  }

  function bounds(vertices) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const vertex of vertices || []) {
      for (let axis = 0; axis < 3; axis++) {
        const value = Number(vertex?.[axis]) || 0;
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
    return {
      min,
      max,
      center: min.map((value, axis) => (value + max[axis]) * .5),
    };
  }

  const subtract = (a, b) => a.map((value, index) => value - b[index]);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const normalize = value => {
    const length = Math.hypot(...value) || 1;
    return value.map(component => component / length);
  };

  function faceCenter(object, face) {
    const result = [0, 0, 0];
    if (!face?.length) return result;
    for (const index of face) {
      const vertex = object.vertices?.[index] || [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) result[axis] += Number(vertex[axis]) || 0;
    }
    return result.map(value => value / face.length);
  }

  function faceDirectionName(object, face) {
    const center = bounds(object.vertices).center;
    const delta = subtract(faceCenter(object, face), center);
    const absolute = delta.map(Math.abs);
    let axis = 0;
    if (absolute[1] > absolute[axis]) axis = 1;
    if (absolute[2] > absolute[axis]) axis = 2;
    if (absolute[axis] < 1e-5) return null;
    if (axis === 0) return delta[0] >= 0 ? 'right' : 'left';
    if (axis === 1) return delta[1] < 0 ? 'front' : 'back';
    return delta[2] >= 0 ? 'top' : 'bottom';
  }

  function outwardFace(object, face) {
    if (!face || face.length < 3) return [...(face || [])];
    const center = bounds(object.vertices).center;
    const a = object.vertices[face[0]] || [0, 0, 0];
    const b = object.vertices[face[1]] || [0, 0, 0];
    const c = object.vertices[face[2]] || [0, 0, 0];
    const normal = cross(subtract(b, a), subtract(c, a));
    const outward = subtract(faceCenter(object, face), center);
    return dot(normal, outward) < 0 ? [...face].reverse() : [...face];
  }

  function canonicalizeBox(object) {
    if (!object || object.type !== 'part' || object.vertices?.length !== 8 || object.faces?.length !== 6) return false;
    if (object.sourceHasAdvancedMeshData) return false;
    if (!object.faces.every(face => Array.isArray(face) && face.length === 4)) return false;

    const byName = new Map();
    object.faces.forEach((face, index) => {
      const name = faceDirectionName(object, face);
      if (name && !byName.has(name)) byName.set(name, index);
    });
    if (!FACE_NAMES.every(name => byName.has(name))) return false;

    const indices = FACE_NAMES.map(name => byName.get(name));
    let changed = indices.some((oldIndex, newIndex) => oldIndex !== newIndex);
    const oldFaces = object.faces.map(face => [...face]);
    const oldMaterials = [...(object.faceMaterials || [])];
    const perFaceKeys = ['faceUVs', 'faceTextureScale', 'faceTextureAxisU', 'faceTextureAxisV', 'faceTextureSizes'];
    const oldPerFace = Object.fromEntries(perFaceKeys.map(key => [key, Array.isArray(object[key]) ? structuredClone(object[key]) : null]));

    object.faces = indices.map(oldIndex => {
      const original = oldFaces[oldIndex];
      const fixed = outwardFace(object, original);
      if (fixed.some((value, i) => value !== original[i])) changed = true;
      return fixed;
    });
    object.faceMaterials = indices.map(oldIndex => oldMaterials[oldIndex] || oldMaterials[0] || 'ERROR');

    for (const key of perFaceKeys) {
      const values = oldPerFace[key];
      if (!values) continue;
      object[key] = indices.map(oldIndex => structuredClone(values[oldIndex]));
      if (key === 'faceUVs') {
        object[key] = object[key].map((value, index) => {
          if (!Array.isArray(value)) return value;
          const originalFace = oldFaces[indices[index]];
          const fixedFace = object.faces[index];
          return fixedFace[0] === originalFace[0] ? value : [...value].reverse();
        });
      }
    }

    object.materials ||= {};
    FACE_NAMES.forEach((name, index) => object.materials[name] = object.faceMaterials[index] || object.faceMaterials[0] || 'ERROR');
    object.size = window.EPH_VMAP?.geometryBounds?.(object.vertices)?.size || object.size;
    return changed;
  }

  function normalFromEuler(rotation) {
    const x = (Number(rotation?.[0]) || 0) * RAD * .5;
    const y = (Number(rotation?.[1]) || 0) * RAD * .5;
    const z = (Number(rotation?.[2]) || 0) * RAD * .5;
    const sx = Math.sin(x), cx = Math.cos(x);
    const sy = Math.sin(y), cy = Math.cos(y);
    const sz = Math.sin(z), cz = Math.cos(z);
    const qx = sx * cy * cz + cx * sy * sz;
    const qy = cx * sy * cz - sx * cy * sz;
    const qz = cx * cy * sz + sx * sy * cz;
    const qw = cx * cy * cz - sx * sy * sz;
    return normalize([
      2 * (qx * qz + qw * qy),
      2 * (qy * qz - qw * qx),
      1 - 2 * (qx * qx + qy * qy),
    ]);
  }

  function stableRotationForNormal(rawNormal) {
    const zAxis = normalize(rawNormal || [0, 0, 1]);
    let up = Math.abs(zAxis[2]) > .95 ? [0, 1, 0] : [0, 0, 1];
    const projection = dot(up, zAxis);
    up = normalize(up.map((value, axis) => value - zAxis[axis] * projection));
    const xAxis = normalize(cross(up, zAxis));
    const yAxis = normalize(cross(zAxis, xAxis));

    const m11 = xAxis[0], m12 = yAxis[0], m13 = zAxis[0];
    const m22 = yAxis[1], m23 = zAxis[1];
    const m32 = yAxis[2], m33 = zAxis[2];
    const y = Math.asin(Math.max(-1, Math.min(1, m13)));
    let x, z;
    if (Math.abs(m13) < .9999999) {
      x = Math.atan2(-m23, m33);
      z = Math.atan2(-m12, m11);
    } else {
      x = Math.atan2(m32, m22);
      z = 0;
    }
    return [x * DEG, y * DEG, z * DEG].map(value => Math.abs(value) < 1e-7 ? 0 : Number(value.toFixed(6)));
  }

  function meshDataFor(doc, object) {
    if (!doc || !object?.dmxId) return null;
    const element = window.EPH_VMAP?.findElementByDmxId?.(doc, object.dmxId);
    return elem(element, 'meshData');
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
      let streamsField = field(dataArray, 'streams');
      if (!streamsField) {
        streamsField = { key: 'streams', type: 'element_array', value: [] };
        dataArray.fields.push(streamsField);
      }
      if (!Array.isArray(streamsField.value)) streamsField.value = [];
      streamsField.value.push(result);
    }
    const data = field(result, 'data');
    if (data) {
      if (!Array.isArray(data.value)) data.value = [];
      while (data.value.length < size) data.value.push('0 0 0 0');
    }
    return result;
  }

  function hydratePaint(doc, object) {
    const meshData = meshDataFor(doc, object);
    const faceVertexData = elem(meshData, 'faceVertexData');
    if (!meshData || !faceVertexData || !object?.vertices?.length) return object;
    const edgeVertex = ary(meshData, 'edgeVertexIndices').map(Number);
    const edgeRows = ary(meshData, 'edgeVertexDataIndices').map(Number);
    const edgeFaces = ary(meshData, 'edgeFaceIndices').map(Number);

    for (const [streamName, objectKey] of [[PAINT_BLEND_STREAM, 'vertexPaintBlendParams'], [PAINT_TINT_STREAM, 'vertexPaintTintColor']]) {
      const source = stream(faceVertexData, streamName);
      const rows = ary(source, 'data');
      if (!source || !rows.length) continue;
      const values = Array.from({ length: object.vertices.length }, () => null);
      for (let edge = 0; edge < edgeVertex.length; edge++) {
        if ((edgeFaces[edge] ?? -1) < 0) continue;
        const vertex = edgeVertex[edge];
        const row = edgeRows[edge];
        if (vertex < 0 || vertex >= values.length || row < 0 || row >= rows.length || values[vertex]) continue;
        values[vertex] = vector4(rows[row]);
      }
      object[objectKey] = values.map(value => value || [0, 0, 0, 0]);
    }
    return object;
  }

  function hasPaint(object) {
    const nonZero = values => Array.isArray(values) && values.some(value => vector4(value).some(component => Math.abs(component) > 1e-6));
    return nonZero(object?.vertexPaintBlendParams) || nonZero(object?.vertexPaintTintColor);
  }

  function writePaint(doc, object) {
    const meshData = meshDataFor(doc, object);
    const faceVertexData = elem(meshData, 'faceVertexData');
    if (!meshData || !faceVertexData || !object?.vertices?.length) return false;
    const edgeVertex = ary(meshData, 'edgeVertexIndices').map(Number);
    const edgeRows = ary(meshData, 'edgeVertexDataIndices').map(Number);

    for (const [streamName, objectKey] of [[PAINT_BLEND_STREAM, 'vertexPaintBlendParams'], [PAINT_TINT_STREAM, 'vertexPaintTintColor']]) {
      if (!Array.isArray(object[objectKey])) continue;
      const targetStream = ensureStream(faceVertexData, streamName);
      const data = field(targetStream, 'data')?.value;
      if (!Array.isArray(data)) continue;
      for (let edge = 0; edge < edgeVertex.length; edge++) {
        const vertex = edgeVertex[edge];
        const row = edgeRows[edge];
        if (vertex < 0 || vertex >= object[objectKey].length || row < 0) continue;
        while (data.length <= row) data.push('0 0 0 0');
        data[row] = vector4String(object[objectKey][vertex]);
      }
    }
    return true;
  }

  function clearPaint(object) {
    const meshData = meshDataFor(S.doc, object);
    const faceVertexData = elem(meshData, 'faceVertexData');
    const streamsField = field(faceVertexData, 'streams');
    if (streamsField && Array.isArray(streamsField.value)) {
      streamsField.value = streamsField.value.filter(item => {
        const name = String(field(item, 'name')?.value || '');
        return name !== PAINT_BLEND_STREAM && name !== PAINT_TINT_STREAM;
      });
    }
    delete object.vertexPaintBlendParams;
    delete object.vertexPaintTintColor;
  }

  function ensurePaintArrays(object) {
    const count = object?.vertices?.length || 0;
    if (!Array.isArray(object.vertexPaintBlendParams) || object.vertexPaintBlendParams.length !== count) {
      object.vertexPaintBlendParams = Array.from({ length: count }, (_, index) => vector4(object.vertexPaintBlendParams?.[index] || [0, 0, 0, 0]));
    }
    if (!Array.isArray(object.vertexPaintTintColor) || object.vertexPaintTintColor.length !== count) {
      object.vertexPaintTintColor = Array.from({ length: count }, (_, index) => vector4(object.vertexPaintTintColor?.[index] || [0, 0, 0, 0]));
    }
  }

  function hexRgb(hex) {
    const clean = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f').slice(0, 6);
    return [0, 2, 4].map(offset => parseInt(clean.slice(offset, offset + 2), 16) / 255);
  }

  function paintObjectAt(object, localPoint, reverse = false) {
    ensurePaintArrays(object);
    const radius = Math.max(1, paintSettings.radius);
    const strength = Math.max(.01, Math.min(1, paintSettings.strength));
    const channel = Math.max(0, Math.min(3, paintSettings.channel));
    const tint = hexRgb(paintSettings.tint);
    let changed = false;

    for (let index = 0; index < object.vertices.length; index++) {
      const vertex = object.vertices[index];
      const distance = Math.hypot(
        (Number(vertex[0]) || 0) - localPoint.x,
        (Number(vertex[1]) || 0) - localPoint.y,
        (Number(vertex[2]) || 0) - localPoint.z,
      );
      if (distance > radius) continue;
      const t = 1 - distance / radius;
      const falloff = t * t * (3 - 2 * t);
      const amount = Math.min(1, strength * falloff);
      if (paintSettings.mode === 'tint') {
        const target = reverse ? [0, 0, 0, 0] : [tint[0], tint[1], tint[2], 1];
        const currentValue = object.vertexPaintTintColor[index];
        for (let axis = 0; axis < 4; axis++) currentValue[axis] += (target[axis] - currentValue[axis]) * amount;
      } else {
        const target = reverse ? 0 : clamp01(paintSettings.value);
        const currentValue = object.vertexPaintBlendParams[index];
        currentValue[channel] += (target - currentValue[channel]) * amount;
      }
      changed = true;
    }
    return changed;
  }

  let overlay = null;
  let overlayHit = null;
  let painting = false;
  let paintingObject = null;

  function ensureOverlay(viewport) {
    if (overlay?.isConnected) return overlay;
    overlay = document.createElement('canvas');
    overlay.id = 'ephVertexPaintOverlay';
    Object.assign(overlay.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '12',
    });
    viewport.container.style.position ||= 'relative';
    viewport.container.appendChild(overlay);
    return overlay;
  }

  function renderPaintOverlay() {
    const viewport = S.viewport;
    const canvas = viewport?.renderer?.domElement;
    if (!viewport || !canvas) return;
    const paintCanvas = ensureOverlay(viewport);
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (paintCanvas.width !== width || paintCanvas.height !== height) { paintCanvas.width = width; paintCanvas.height = height; }
    const ctx = paintCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    paintCanvas.style.display = S.tool === 'vertex-paint' ? 'block' : 'none';
    if (S.tool !== 'vertex-paint') return;

    const object = current?.();
    const root = object ? viewport.objectRoots.get(object.id) : null;
    if (!object || !root || !['part', 'terrain'].includes(object.type)) return;
    ensurePaintArrays(object);
    root.updateMatrixWorld(true);

    for (let index = 0; index < object.vertices.length; index++) {
      const vertex = object.vertices[index];
      const point = root.position.clone().set(Number(vertex[0]) || 0, Number(vertex[1]) || 0, Number(vertex[2]) || 0);
      root.localToWorld(point);
      point.project(viewport.camera);
      if (point.z < -1 || point.z > 1) continue;
      const x = (point.x * .5 + .5) * rect.width;
      const y = (-point.y * .5 + .5) * rect.height;
      const blend = clamp01(object.vertexPaintBlendParams[index]?.[paintSettings.channel] || 0);
      const tintValue = object.vertexPaintTintColor[index] || [0, 0, 0, 0];
      if (paintSettings.mode === 'tint' && tintValue[3] > .001) {
        ctx.fillStyle = `rgba(${Math.round(clamp01(tintValue[0]) * 255)},${Math.round(clamp01(tintValue[1]) * 255)},${Math.round(clamp01(tintValue[2]) * 255)},${Math.max(.25, clamp01(tintValue[3]))})`;
      } else {
        const alpha = .25 + blend * .75;
        ctx.fillStyle = `rgba(255,156,40,${alpha})`;
      }
      ctx.beginPath(); ctx.arc(x, y, 3.3, 0, Math.PI * 2); ctx.fill();
    }

    if (overlayHit?.object === object) {
      const local = overlayHit.local;
      const center = root.position.clone().set(local.x, local.y, local.z);
      const edge = root.position.clone().set(local.x + paintSettings.radius, local.y, local.z);
      root.localToWorld(center); root.localToWorld(edge);
      center.project(viewport.camera); edge.project(viewport.camera);
      const cx = (center.x * .5 + .5) * rect.width;
      const cy = (-center.y * .5 + .5) * rect.height;
      const ex = (edge.x * .5 + .5) * rect.width;
      const ey = (-edge.y * .5 + .5) * rect.height;
      const radius = Math.max(6, Math.hypot(ex - cx, ey - cy));
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function paintHit(event) {
    const viewport = S.viewport;
    const object = current?.();
    if (!viewport || !object || !['part', 'terrain'].includes(object.type)) return null;
    const root = viewport.objectRoots.get(object.id);
    if (!root) return null;
    const rect = viewport.renderer.domElement.getBoundingClientRect();
    viewport.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    viewport.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
    const hit = viewport.raycaster.intersectObject(root, true)[0];
    if (!hit) return null;
    root.updateMatrixWorld(true);
    return { object, root, hit, local: root.worldToLocal(hit.point.clone()) };
  }

  function installPaintInteraction() {
    const viewport = S.viewport;
    const canvas = viewport?.renderer?.domElement;
    if (!viewport || !canvas || canvas.dataset.ephVertexPaint === '1') return;
    canvas.dataset.ephVertexPaint = '1';
    ensureOverlay(viewport);

    canvas.addEventListener('pointermove', event => {
      if (S.tool !== 'vertex-paint') { overlayHit = null; return; }
      const info = paintHit(event);
      overlayHit = info;
      if (!painting || !info || info.object !== paintingObject) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      paintObjectAt(info.object, info.local, event.shiftKey);
    }, true);

    canvas.addEventListener('pointerdown', event => {
      if (S.tool !== 'vertex-paint' || event.button !== 0) return;
      const info = paintHit(event);
      if (!info) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pushHistory?.();
      painting = true;
      paintingObject = info.object;
      overlayHit = info;
      paintObjectAt(info.object, info.local, event.shiftKey);
    }, true);

    window.addEventListener('pointerup', event => {
      if (!painting || event.button !== 0) return;
      const object = paintingObject;
      painting = false;
      paintingObject = null;
      if (!object) return;
      writePaint(S.doc, object);
      markDirty?.(`Vertex painted ${object.name}`);
      renderProperties?.();
    }, true);

    const loop = () => { renderPaintOverlay(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  function paintControlsHtml(object) {
    const painted = hasPaint(object);
    const mode = paintSettings.mode;
    return `<div class="property-section eph-vertex-paint-section">
      <div class="property-section-title">Vertex Paint / Material Blending</div>
      <div class="eph-field"><label>Mode</label><select id="ephVertexPaintMode" class="prop-select"><option value="blend" ${mode === 'blend' ? 'selected' : ''}>Blend weights</option><option value="tint" ${mode === 'tint' ? 'selected' : ''}>Vertex tint</option></select></div>
      <div class="eph-field" id="ephVertexBlendChannelRow"><label>Blend channel</label><select id="ephVertexPaintChannel" class="prop-select">${[0,1,2,3].map(index => `<option value="${index}" ${index === paintSettings.channel ? 'selected' : ''}>Layer ${index + 1} (${['X','Y','Z','W'][index]})</option>`).join('')}</select></div>
      <div class="eph-pair"><label>Radius</label><input id="ephVertexPaintRadius" class="prop-input" type="number" min="1" step="1" value="${paintSettings.radius}"><label>Strength</label><input id="ephVertexPaintStrength" class="prop-input" type="number" min="0.01" max="1" step="0.01" value="${paintSettings.strength}"></div>
      <div class="eph-field" id="ephVertexBlendValueRow"><label>Blend value</label><input id="ephVertexPaintValue" class="prop-input" type="number" min="0" max="1" step="0.05" value="${paintSettings.value}"></div>
      <div class="eph-field" id="ephVertexTintRow"><label>Tint</label><input id="ephVertexPaintTint" type="color" value="${paintSettings.tint}"></div>
      <div class="geometry-actions"><button id="ephStartVertexPaint" class="mini-button wide">Paint vertices</button><button id="ephClearVertexPaint" class="mini-button wide" ${painted ? '' : 'disabled'}>Clear paint</button></div>
      <div class="selection-info">Paints Hammer's real <code>VertexPaintBlendParams:0</code> / <code>VertexPaintTintColor:0</code> streams. Hold Shift while painting to erase. Visible material blending requires a VMAT that supports vertex-paint blending.${painted ? ' Topology-changing Extrude/Clip/Rebuild is locked until paint is cleared.' : ''}</div>
    </div>`;
  }

  function bindPaintControls(object) {
    const mode = document.getElementById('ephVertexPaintMode');
    if (!mode) return;
    const channelRow = document.getElementById('ephVertexBlendChannelRow');
    const valueRow = document.getElementById('ephVertexBlendValueRow');
    const tintRow = document.getElementById('ephVertexTintRow');
    const syncMode = () => {
      const blend = mode.value === 'blend';
      channelRow?.classList.toggle('hidden', !blend);
      valueRow?.classList.toggle('hidden', !blend);
      tintRow?.classList.toggle('hidden', blend);
    };
    syncMode();
    mode.onchange = () => { paintSettings.mode = mode.value; savePaintSettings(); syncMode(); };
    document.getElementById('ephVertexPaintChannel').onchange = event => { paintSettings.channel = Math.max(0, Math.min(3, Number(event.target.value) || 0)); savePaintSettings(); };
    document.getElementById('ephVertexPaintRadius').onchange = event => { paintSettings.radius = Math.max(1, Number(event.target.value) || 1); event.target.value = String(paintSettings.radius); savePaintSettings(); };
    document.getElementById('ephVertexPaintStrength').onchange = event => { paintSettings.strength = Math.max(.01, Math.min(1, Number(event.target.value) || .01)); event.target.value = String(paintSettings.strength); savePaintSettings(); };
    document.getElementById('ephVertexPaintValue').onchange = event => { paintSettings.value = clamp01(event.target.value); event.target.value = String(paintSettings.value); savePaintSettings(); };
    document.getElementById('ephVertexPaintTint').onchange = event => { paintSettings.tint = event.target.value || '#ffffff'; savePaintSettings(); };
    document.getElementById('ephStartVertexPaint').onclick = () => {
      setTool?.('vertex-paint');
      toast?.('Vertex Paint active — drag on the selected mesh; hold Shift to erase');
    };
    document.getElementById('ephClearVertexPaint').onclick = () => {
      pushHistory?.();
      clearPaint(object);
      markDirty?.(`Cleared vertex paint on ${object.name}`);
      renderProperties?.();
    };

    if (hasPaint(object)) {
      const extrudeButton = document.getElementById('extrudeFaceButton');
      const clipButton = document.getElementById('clipApply');
      const rebuildButton = document.getElementById('ephRebuildTerrain');
      for (const button of [extrudeButton, clipButton, rebuildButton]) {
        if (!button) continue;
        button.disabled = true;
        button.title = 'Clear vertex paint before changing mesh topology.';
      }
    }
  }

  function installPropertyPaintUi() {
    if (renderProperties?.__ephVertexPaintUi) return;
    const rawRender = renderProperties;
    renderProperties = function() {
      const result = rawRender();
      const object = current?.();
      const host = document.getElementById('propertiesContent');
      if (object && host && ['part', 'terrain'].includes(object.type) && !host.querySelector('.eph-vertex-paint-section')) {
        host.insertAdjacentHTML('beforeend', paintControlsHtml(object));
        bindPaintControls(object);
      }
      return result;
    };
    renderProperties.__ephVertexPaintUi = true;
  }

  function installPaintExtraction() {
    const VMAP = window.EPH_VMAP;
    if (!VMAP || VMAP.__ephVertexPaintExtract) return;
    VMAP.__ephVertexPaintExtract = true;
    const rawExtract = VMAP.extractObjects.bind(VMAP);
    VMAP.extractObjects = function(doc) {
      const objects = rawExtract(doc);
      for (const object of objects || []) if (object?.dmxId) hydratePaint(doc, object);
      return objects;
    };
    for (const object of S.objects || []) if (object?.dmxId) hydratePaint(S.doc, object);
  }

  function installOrientationFixes() {
    const VMAP = window.EPH_VMAP;
    if (!VMAP || VMAP.__ephOrientationV13) return;
    VMAP.__ephOrientationV13 = true;
    const rawAddPart = VMAP.addPart.bind(VMAP);
    VMAP.addPart = function(doc, options = {}) {
      let nextOptions = options;
      if (/^EPH_DECAL_/i.test(String(options.meshName || '')) && Array.isArray(options.rotation)) {
        nextOptions = { ...options, rotation: stableRotationForNormal(normalFromEuler(options.rotation)) };
      }
      const object = rawAddPart(doc, nextOptions);
      if (object && !nextOptions.vertices?.length && canonicalizeBox(object)) VMAP.applyObjectToDocument(doc, object);
      return object;
    };

    const repairLoaded = () => {
      if (!S.doc) return false;
      let changed = false;
      for (const object of S.objects || []) {
        if (object?.type !== 'part' || !/^Part_/i.test(String(object.name || ''))) continue;
        if (!canonicalizeBox(object)) continue;
        VMAP.applyObjectToDocument(S.doc, object);
        changed = true;
      }
      if (changed) {
        S.viewport?.setObjects?.(S.objects, S.selectedId);
        S.dirty = true;
        updateTitle?.();
        log?.('Repaired Part face orientation / Top-Bottom mapping', 'success');
      }
      return changed;
    };

    if (typeof loadProject === 'function' && !loadProject.__ephOrientationV13) {
      const rawLoadProject = loadProject;
      loadProject = async function(...args) {
        const result = await rawLoadProject(...args);
        if (result) repairLoaded();
        return result;
      };
      loadProject.__ephOrientationV13 = true;
      window.loadProject = loadProject;
    }
    repairLoaded();
  }

  function cleanToolRail() {
    const rail = document.getElementById('toolRail');
    if (!rail) return;
    const removeSelectors = [
      '[data-tool="add-part"]', '[data-tool="face"]', '[data-tool="extrude"]', '[data-tool="clip"]',
      '[data-tool="texture"]', '[data-tool="light"]', '[data-tool="entity"]', '#ephRailDecal', '#ephRailTerrain',
    ];
    rail.querySelectorAll(removeSelectors.join(',')).forEach(button => button.remove());

    if (!document.getElementById('ephRailVertexPaint')) {
      const button = document.createElement('button');
      button.id = 'ephRailVertexPaint';
      button.dataset.tool = 'vertex-paint';
      button.innerHTML = '<img src="../assets/icons/tools/tool_vertex.png" alt=""><span>Vertex Paint</span>';
      button.onclick = () => {
        setTool?.('vertex-paint');
        toast?.('Vertex Paint active — select a Part or Terrain and drag on it');
      };
      rail.appendChild(button);
      icons?.(button);
    }
  }

  function installTopologyPaintGuards() {
    if (typeof extrude === 'function' && !extrude.__ephPaintGuard) {
      const rawExtrude = extrude;
      extrude = function(...args) {
        if (hasPaint(current?.())) return toast?.('Clear vertex paint before Extrude so Hammer paint data is not destroyed.');
        return rawExtrude(...args);
      };
      extrude.__ephPaintGuard = true;
    }
    if (typeof clipSelected === 'function' && !clipSelected.__ephPaintGuard) {
      const rawClip = clipSelected;
      clipSelected = function(...args) {
        if (hasPaint(current?.())) return toast?.('Clear vertex paint before Clip so Hammer paint data is not destroyed.');
        return rawClip(...args);
      };
      clipSelected.__ephPaintGuard = true;
    }
  }

  function install() {
    const button = document.getElementById('topAddPart');
    if (button) button.onclick = () => addPart();
    installPaintExtraction();
    installOrientationFixes();
    installPropertyPaintUi();
    installPaintInteraction();
    installTopologyPaintGuards();
    cleanToolRail();
    if (S.project) renderProperties?.();
  }

  install();
  window.addEventListener('eph3d-ready', install, { once: true });
})();
