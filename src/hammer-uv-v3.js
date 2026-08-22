// byanca
import * as THREE from 'three';

const VMAP = window.EPH_VMAP;
const VRF_TEXTURE_SCALE = 0.03125;

function vrfFaceUvs(object, faceIndex) {
  const face = object?.faces?.[faceIndex];
  if (!face?.length) return [];
  const normal = VMAP.faceNormal(object.vertices || [], face);
  const weights = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])];

  return face.map(vertexIndex => {
    const p = object.vertices?.[vertexIndex] || [0, 0, 0];
    const topU = p[0] * weights[2];
    const topV = -p[1] * weights[2];
    const frontU = p[0] * weights[1];
    const frontV = -p[2] * weights[1];
    const sideU = p[1] * weights[0];
    const sideV = -p[2] * weights[0];
    return [
      (topU + frontU + sideU) * VRF_TEXTURE_SCALE,
      (topV + frontV + sideV) * VRF_TEXTURE_SCALE
    ];
  });
}

function applyVrfUvs(object, faceIndices = null) {
  if (!object || object.type !== 'part' || !object.faces?.length) return object;
  object.faceUVs ??= [];
  const indices = faceIndices || object.faces.map((_, index) => index);
  for (const faceIndex of indices) {
    if (!object.faces[faceIndex]) continue;
    object.faceUVs[faceIndex] = vrfFaceUvs(object, faceIndex);
  }
  object.faceUVs.length = object.faces.length;
  return object;
}

if (VMAP && !VMAP.__ephVrfUvPatch) {
  VMAP.__ephVrfUvPatch = true;

  const oldAddPart = VMAP.addPart.bind(VMAP);
  VMAP.addPart = (doc, options = {}) => {
    const object = applyVrfUvs(oldAddPart(doc, options));
    VMAP.applyObjectToDocument(doc, object);
    return object;
  };

  const oldExtract = VMAP.extractObjects.bind(VMAP);
  VMAP.extractObjects = doc => oldExtract(doc).map(object => object?.type === 'part' ? applyVrfUvs(object) : object);

  const oldExtrude = VMAP.extrudeFace.bind(VMAP);
  VMAP.extrudeFace = (object, faceIndex, distance) => {
    const result = oldExtrude(object, faceIndex, distance);
    if (result) applyVrfUvs(object);
    return result;
  };

  const oldClip = VMAP.clipAxis.bind(VMAP);
  VMAP.clipAxis = (object, axis, plane, keepPositive) => {
    const result = oldClip(object, axis, plane, keepPositive);
    if (result) applyVrfUvs(object);
    return result;
  };
}

if (window.EPH_HAMMER_FIDELITY) {
  window.EPH_HAMMER_FIDELITY.generateFaceUv = (object, faceIndex) => vrfFaceUvs(object, faceIndex);
  window.EPH_HAMMER_FIDELITY.setFaceMaterialInfo = (object, faceIndices) => applyVrfUvs(object, faceIndices);
}

function installViewport(viewport) {
  if (!viewport || viewport.__ephVrfUvViewport) return;
  viewport.__ephVrfUvViewport = true;

  const previousCreatePartVisual = viewport.createPartVisual.bind(viewport);
  viewport.createPartVisual = function(object) {
    applyVrfUvs(object);
    return previousCreatePartVisual(object);
  };

  if (viewport.objects?.length) {
    for (const object of viewport.objects) if (object?.type === 'part') applyVrfUvs(object);
    viewport.setObjects(viewport.objects, viewport.selectedId);
  }
}

window.EPH_VRF_UV = { applyVrfUvs, vrfFaceUvs, scale: VRF_TEXTURE_SCALE };
if (window.EPH3D) installViewport(window.EPH3D);
window.addEventListener('eph3d-ready', event => installViewport(event.detail));
