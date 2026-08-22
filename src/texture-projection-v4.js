// byanca
import * as THREE from 'three';

const VMAP = window.EPH_VMAP;
const TILE_WORLD_UNITS = 16;
const UV_PER_WORLD_UNIT = 1 / TILE_WORLD_UNITS;
const DEFAULT_SCALE = [0.25, 0.25];
const DEFAULT_SIZE = [512, 512];

const numbers = (value, length, fallback = 0) => {
  const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
  return Array.from({ length }, (_, i) => Number.isFinite(Number(source[i])) ? Number(source[i]) : fallback);
};

const dot3 = (a, b) => (Number(a?.[0]) || 0) * (Number(b?.[0]) || 0)
  + (Number(a?.[1]) || 0) * (Number(b?.[1]) || 0)
  + (Number(a?.[2]) || 0) * (Number(b?.[2]) || 0);

function defaultAxes(vertices, face) {
  const normal = VMAP.faceNormal(vertices || [], face || []);
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);

  if (az >= ax && az >= ay) return { u: [1, 0, 0, 0], v: [0, -1, 0, 0] };
  if (ax >= ay) return { u: [0, 1, 0, 0], v: [0, 0, -1, 0] };
  return { u: [1, 0, 0, 0], v: [0, 0, -1, 0] };
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

  object.faceTextureScale[faceIndex] = [...DEFAULT_SCALE];
  object.faceTextureAxisU[faceIndex] = axisU;
  object.faceTextureAxisV[faceIndex] = axisV;
  object.faceTextureSizes[faceIndex] = [textureWidth, textureHeight];

  const shiftU = Number(axisU[3]) || 0;
  const shiftV = Number(axisV[3]) || 0;
  const uv = face.map(vertexIndex => {
    const point = object.vertices?.[vertexIndex] || [0, 0, 0];
    return [
      dot3(point, axisU) * UV_PER_WORLD_UNIT + shiftU,
      dot3(point, axisV) * UV_PER_WORLD_UNIT + shiftV,
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
    object.faceTextureScale[faceIndex] = [...DEFAULT_SCALE];
    object.faceTextureAxisU[faceIndex] = axes.u;
    object.faceTextureAxisV[faceIndex] = axes.v;
    object.faceTextureSizes[faceIndex] = [Math.max(1, Number(width) || 512), Math.max(1, Number(height) || 512)];
    if (isGeneratedPart(object)) projectFace(object, faceIndex, width, height);
  }
  return object;
}

if (VMAP && !VMAP.__ephTextureProjectionV4) {
  VMAP.__ephTextureProjectionV4 = true;

  const previousAddPart = VMAP.addPart.bind(VMAP);
  VMAP.addPart = (doc, options = {}) => {
    const object = markGeneratedPart(previousAddPart(doc, options));
    projectObject(object, null, true);
    return object;
  };

  const previousApply = VMAP.applyObjectToDocument.bind(VMAP);
  VMAP.applyObjectToDocument = (doc, object) => {
    if (isGeneratedPart(object)) projectObject(object);
    return previousApply(doc, object);
  };

  const previousPrepare = VMAP.prepareForSave.bind(VMAP);
  VMAP.prepareForSave = (doc, objects) => {
    for (const object of objects || []) if (isGeneratedPart(object)) projectObject(object);
    return previousPrepare(doc, objects);
  };

  const previousExtrude = VMAP.extrudeFace.bind(VMAP);
  VMAP.extrudeFace = (object, faceIndex, distance) => {
    const result = previousExtrude(object, faceIndex, distance);
    if (result && isGeneratedPart(object)) projectObject(object);
    return result;
  };

  const previousClip = VMAP.clipAxis.bind(VMAP);
  VMAP.clipAxis = (object, axis, plane, keepPositive) => {
    const result = previousClip(object, axis, plane, keepPositive);
    if (result && isGeneratedPart(object)) projectObject(object);
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

  if (viewport.objects?.length) {
    for (const object of viewport.objects) {
      if (/^Part_\d+$/i.test(String(object?.name || ''))) markGeneratedPart(object);
      if (isGeneratedPart(object)) projectObject(object, null, true);
    }
    viewport.setObjects(viewport.objects, viewport.selectedId);
  }
}

window.EPH_TEXTURE_PROJECTION_V4 = {
  defaultAxes,
  isGeneratedPart,
  markGeneratedPart,
  projectFace,
  projectObject,
  setFaceMaterialInfo,
  defaultScale: DEFAULT_SCALE,
  tileWorldUnits: TILE_WORLD_UNITS,
  uvPerWorldUnit: UV_PER_WORLD_UNIT,
};

if (window.EPH3D) installViewport(window.EPH3D);
window.addEventListener('eph3d-ready', event => installViewport(event.detail));