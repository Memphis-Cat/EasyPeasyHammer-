// byanca
import * as THREE from 'three';

const VMAP = window.EPH_VMAP;
const TILE_WORLD_UNITS = 16;
const UV_PER_WORLD_UNIT = 1 / TILE_WORLD_UNITS;
const DEFAULT_SCALE = [0.125, 0.125];
const DEFAULT_SIZE = [512, 512];
const DEG = 180 / Math.PI;

const numbers = (value, length, fallback = 0) => {
  const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
  return Array.from({ length }, (_, i) => Number.isFinite(Number(source[i])) ? Number(source[i]) : fallback);
};

const dot3 = (a, b) => (Number(a?.[0]) || 0) * (Number(b?.[0]) || 0)
  + (Number(a?.[1]) || 0) * (Number(b?.[1]) || 0)
  + (Number(a?.[2]) || 0) * (Number(b?.[2]) || 0);

function defaultAxes(vertices, face) {
  if (VMAP.defaultTextureAxes) return VMAP.defaultTextureAxes(vertices || [], face || []);
  const normal = VMAP.faceNormal(vertices || [], face || []);
  const candidates = [
    { n: [0, 0, 1], u: [1, 0, 0, 0], v: [0, -1, 0, 0] },
    { n: [0, 0, -1], u: [1, 0, 0, 0], v: [0, -1, 0, 0] },
    { n: [0, -1, 0], u: [1, 0, 0, 0], v: [0, 0, -1, 0] },
    { n: [0, 1, 0], u: [-1, 0, 0, 0], v: [0, 0, -1, 0] },
    { n: [-1, 0, 0], u: [0, -1, 0, 0], v: [0, 0, -1, 0] },
    { n: [1, 0, 0], u: [0, 1, 0, 0], v: [0, 0, -1, 0] },
  ];
  let best = candidates[0];
  let score = -Infinity;
  for (const candidate of candidates) {
    const next = normal[0] * candidate.n[0] + normal[1] * candidate.n[1] + normal[2] * candidate.n[2];
    if (next >= score) { score = next; best = candidate; }
  }
  return { u: [...best.u], v: [...best.v] };
}

function isGeneratedPart(object) {
  if (!object || object.type !== 'part') return false;
  if (object.ephProjectionMode === 'tile16') return true;
  return /^Part_\d+$/i.test(String(object.name || ''));
}

function markGeneratedPart(object) {
  if (!object || object.type !== 'part') return object;
  object.ephProjectionMode = 'tile16';
  return object;
}

function generatedScale(width, height) {
  return [
    TILE_WORLD_UNITS / Math.max(1, Number(width) || 512),
    TILE_WORLD_UNITS / Math.max(1, Number(height) || 512),
  ];
}

function projectFace(object, faceIndex, width = null, height = null) {
  const face = object?.faces?.[faceIndex];
  if (!face?.length) return [];

  object.faceUVs ??= [];
  object.faceTextureScale ??= [];
  object.faceTextureAxisU ??= [];
  object.faceTextureAxisV ??= [];
  object.faceTextureSizes ??= [];

  const fallbackAxes = defaultAxes(object.vertices, face);
  const axisU = numbers(object.faceTextureAxisU[faceIndex] || fallbackAxes.u, 4, 0);
  const axisV = numbers(object.faceTextureAxisV[faceIndex] || fallbackAxes.v, 4, 0);
  const storedSize = numbers(object.faceTextureSizes[faceIndex] || DEFAULT_SIZE, 2, 512);
  const textureWidth = Math.max(1, Number(width) || storedSize[0] || 512);
  const textureHeight = Math.max(1, Number(height) || storedSize[1] || 512);
  const scale = generatedScale(textureWidth, textureHeight);

  object.faceTextureScale[faceIndex] = scale;
  object.faceTextureAxisU[faceIndex] = axisU;
  object.faceTextureAxisV[faceIndex] = axisV;
  object.faceTextureSizes[faceIndex] = [textureWidth, textureHeight];

  const shiftU = Number(axisU[3]) || 0;
  const shiftV = Number(axisV[3]) || 0;
  const uv = face.map(vertexIndex => {
    const point = object.vertices?.[vertexIndex] || [0, 0, 0];
    return [
      (dot3(point, axisU) / scale[0] + shiftU) / textureWidth,
      (dot3(point, axisV) / scale[1] + shiftV) / textureHeight,
    ];
  });

  object.faceUVs[faceIndex] = uv;
  return uv;
}

function projectObject(object, faceIndices = null, force = false) {
  if (!object || object.type !== 'part' || !object.faces?.length) return object;
  if (!force && !isGeneratedPart(object)) return object;

  const indices = faceIndices || object.faces.map((_, index) => index);
  for (const faceIndex of indices) {
    if (!object.faces[faceIndex]) continue;
    const size = object.faceTextureSizes?.[faceIndex] || DEFAULT_SIZE;
    projectFace(object, faceIndex, size[0], size[1]);
  }
  object.faceUVs.length = object.faces.length;
  return object;
}

function setFaceMaterialInfo(object, faceIndices, width, height) {
  if (!object || object.type !== 'part') return object;
  object.faceTextureScale ??= [];
  object.faceTextureAxisU ??= [];
  object.faceTextureAxisV ??= [];
  object.faceTextureSizes ??= [];

  if (isGeneratedPart(object)) markGeneratedPart(object);
  for (const faceIndex of faceIndices || []) {
    const face = object.faces?.[faceIndex];
    if (!face) continue;
    const axes = defaultAxes(object.vertices, face);
    const textureWidth = Math.max(1, Number(width) || 512);
    const textureHeight = Math.max(1, Number(height) || 512);
    object.faceTextureScale[faceIndex] = isGeneratedPart(object) ? generatedScale(textureWidth, textureHeight) : [...DEFAULT_SCALE];
    object.faceTextureAxisU[faceIndex] = axes.u;
    object.faceTextureAxisV[faceIndex] = axes.v;
    object.faceTextureSizes[faceIndex] = [textureWidth, textureHeight];
    if (isGeneratedPart(object)) projectFace(object, faceIndex, textureWidth, textureHeight);
  }
  return object;
}

function hasNonUnitScale(scale) {
  if (!Array.isArray(scale) || scale.length < 3) return false;
  return scale.some(value => Math.abs((Number(value) || 1) - 1) > 1e-6);
}

function bakePartScale(object, scale = object?.scale) {
  if (!object || object.type !== 'part' || !object.vertices?.length || !hasNonUnitScale(scale)) return false;

  const sx = Number(scale?.[0]);
  const sy = Number(scale?.[1]);
  const sz = Number(scale?.[2]);
  const safeX = Number.isFinite(sx) && Math.abs(sx) > 1e-8 ? sx : 1;
  const safeY = Number.isFinite(sy) && Math.abs(sy) > 1e-8 ? sy : 1;
  const safeZ = Number.isFinite(sz) && Math.abs(sz) > 1e-8 ? sz : 1;

  object.vertices = object.vertices.map(vertex => [
    (Number(vertex?.[0]) || 0) * safeX,
    (Number(vertex?.[1]) || 0) * safeY,
    (Number(vertex?.[2]) || 0) * safeZ,
  ]);
  object.scale = [1, 1, 1];
  if (VMAP.geometryBounds) object.size = VMAP.geometryBounds(object.vertices).size;
  markGeneratedPart(object);
  projectObject(object, null, true);
  return true;
}

if (VMAP && !VMAP.__ephTextureProjectionV4) {
  VMAP.__ephTextureProjectionV4 = true;

  const previousAddPart = VMAP.addPart.bind(VMAP);
  VMAP.addPart = (doc, options = {}) => {
    const object = previousAddPart(doc, options);
    const specialMesh = /^EPH_(?:DECAL|TERRAIN)_/i.test(String(options.meshName || ''));
    if (specialMesh) return object;
    markGeneratedPart(object);
    projectObject(object, null, true);
    return object;
  };

  const previousApply = VMAP.applyObjectToDocument.bind(VMAP);
  VMAP.applyObjectToDocument = (doc, object) => {
    if (isGeneratedPart(object)) {
      bakePartScale(object);
      projectObject(object, null, true);
    }
    return previousApply(doc, object);
  };

  const previousPrepare = VMAP.prepareForSave.bind(VMAP);
  VMAP.prepareForSave = (doc, objects) => {
    for (const object of objects || []) {
      if (!isGeneratedPart(object)) continue;
      bakePartScale(object);
      projectObject(object, null, true);
    }
    return previousPrepare(doc, objects);
  };

  const previousExtrude = VMAP.extrudeFace.bind(VMAP);
  VMAP.extrudeFace = (object, faceIndex, distance) => {
    const result = previousExtrude(object, faceIndex, distance);
    if (result && isGeneratedPart(object)) projectObject(object, null, true);
    return result;
  };

  const previousClip = VMAP.clipAxis.bind(VMAP);
  VMAP.clipAxis = (object, axis, plane, keepPositive) => {
    const result = previousClip(object, axis, plane, keepPositive);
    if (result && isGeneratedPart(object)) projectObject(object, null, true);
    return result;
  };
}

if (window.EPH_HAMMER_FIDELITY) {
  window.EPH_HAMMER_FIDELITY.generateFaceUv = projectFace;
  window.EPH_HAMMER_FIDELITY.setFaceMaterialInfo = setFaceMaterialInfo;
  window.EPH_HAMMER_FIDELITY.refreshMappings = projectObject;
}

function installViewport(viewport) {
  if (!viewport || viewport.__ephTextureProjectionV4) return;
  viewport.__ephTextureProjectionV4 = true;

  const previousCreatePartVisual = viewport.createPartVisual.bind(viewport);
  viewport.createPartVisual = function(object) {
    if (/^Part_\d+$/i.test(String(object?.name || '')) && object.ephProjectionMode !== 'tile16') markGeneratedPart(object);
    if (isGeneratedPart(object)) projectObject(object, null, true);
    return previousCreatePartVisual(object);
  };

  const previousLoadTexture = viewport.loadMaterialTexture.bind(viewport);
  viewport.loadMaterialTexture = async function(resource) {
    const texture = await previousLoadTexture(resource);
    if (!texture) return texture;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    texture.needsUpdate = true;
    return texture;
  };

  const previousCommitObjectTransform = viewport.commitObjectTransform.bind(viewport);
  viewport.commitObjectTransform = function() {
    const object = this.getObjectById(this.selectedId);
    const root = this.objectRoots.get(this.selectedId);
    if (!object || !root || object.type !== 'part' || this.tool !== 'scale') return previousCommitObjectTransform();

    object.position = [root.position.x, root.position.y, root.position.z];
    object.rotation = [root.rotation.x * DEG, root.rotation.y * DEG, root.rotation.z * DEG];
    const scale = [root.scale.x, root.scale.y, root.scale.z];
    object.scale = scale;
    bakePartScale(object, scale);
    root.scale.set(1, 1, 1);
    this.refreshSelectedPartVisual();
    this.callbacks.change?.(object, true);
    this.updateSelectionBox();
  };

  if (viewport.objects?.length) {
    let repaired = false;
    for (const object of viewport.objects) {
      if (/^Part_\d+$/i.test(String(object?.name || ''))) markGeneratedPart(object);
      if (!isGeneratedPart(object)) continue;
      repaired = bakePartScale(object) || repaired;
      projectObject(object, null, true);
    }
    viewport.setObjects(viewport.objects, viewport.selectedId);
    if (repaired) {
      for (const object of viewport.objects) if (isGeneratedPart(object)) viewport.callbacks.change?.(object, true);
    }
  }
}

window.EPH_TEXTURE_PROJECTION_V4 = {
  defaultAxes,
  isGeneratedPart,
  markGeneratedPart,
  projectFace,
  projectObject,
  setFaceMaterialInfo,
  bakePartScale,
  defaultScale: DEFAULT_SCALE,
  tileWorldUnits: TILE_WORLD_UNITS,
  uvPerWorldUnit: UV_PER_WORLD_UNIT,
};

if (window.EPH3D) installViewport(window.EPH3D);
window.addEventListener('eph3d-ready', event => installViewport(event.detail));