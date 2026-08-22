// byanca
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const VMAP = window.EPH_VMAP;
const DEFAULT_SCALE = [0.25, 0.25];
const DEFAULT_TEXTURE_SIZE = [512, 512];
const CT_MODEL = 'characters/models/ctm_sas/ctm_sas.vmdl';
const T_MODEL = 'characters/models/tm_phoenix/tm_phoenix.vmdl';

const field = (e, key) => e?.fields?.find(f => f.key === key) || null;
const get = (e, key, fallback = null) => field(e, key)?.value ?? fallback;
const elem = (e, key) => { const value = get(e, key); return value?.kind === 'element' ? value : null; };
const ary = (e, key) => Array.isArray(get(e, key)) ? get(e, key) : [];
const stream = (dataArray, name) => ary(dataArray, 'streams').find(x => x?.kind === 'element' && get(x, 'name') === name) || null;
const numbers = (value, length, fallback = 0) => {
  const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
  return Array.from({ length }, (_, i) => Number.isFinite(Number(source[i])) ? Number(source[i]) : fallback);
};
const vectorString = value => value.map(x => {
  const n = Number(x) || 0;
  return Math.abs(n) < 1e-9 ? '0' : Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}).join(' ');
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function setStreamData(dataArray, name, values) {
  const s = stream(dataArray, name);
  if (!s) return false;
  const dataField = field(s, 'data');
  if (!dataField) return false;
  dataField.value = values.map(value => Array.isArray(value) ? vectorString(value) : String(value));
  return true;
}

function meshLoops(meshData) {
  const starts = ary(meshData, 'faceEdgeIndices').map(Number);
  const next = ary(meshData, 'edgeNextIndices').map(Number);
  const edgeVertex = ary(meshData, 'edgeVertexIndices').map(Number);
  const edgeVertexData = ary(meshData, 'edgeVertexDataIndices').map(Number);
  const loops = [];
  for (const start of starts) {
    const vertices = [];
    const dataIndices = [];
    const seen = new Set();
    let edge = start;
    while (Number.isInteger(edge) && edge >= 0 && edge < next.length && !seen.has(edge)) {
      seen.add(edge);
      if (Number.isInteger(edgeVertex[edge]) && edgeVertex[edge] >= 0) {
        vertices.push(edgeVertex[edge]);
        dataIndices.push(Number.isInteger(edgeVertexData[edge]) ? edgeVertexData[edge] : edge);
      }
      edge = next[edge];
      if (edge === start) break;
    }
    if (vertices.length >= 3) loops.push({ vertices, dataIndices });
  }
  return loops;
}

function defaultAxes(vertices, face) {
  const normal = VMAP.faceNormal(vertices, face);
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2]);
  if (az >= ax && az >= ay) return { u: [1, 0, 0, 0], v: [0, -1, 0, 0] };
  if (ax >= ay) return { u: [0, 1, 0, 0], v: [0, 0, -1, 0] };
  return { u: [1, 0, 0, 0], v: [0, 0, -1, 0] };
}

function generateFaceUv(object, faceIndex, width = 512, height = 512) {
  const face = object.faces?.[faceIndex];
  if (!face?.length) return [];
  const axes = defaultAxes(object.vertices, face);
  object.faceTextureScale ??= [];
  object.faceTextureAxisU ??= [];
  object.faceTextureAxisV ??= [];
  object.faceTextureSizes ??= [];
  const scale = numbers(object.faceTextureScale[faceIndex] || DEFAULT_SCALE, 2, 0.25);
  const axisU = numbers(object.faceTextureAxisU[faceIndex] || axes.u, 4, 0);
  const axisV = numbers(object.faceTextureAxisV[faceIndex] || axes.v, 4, 0);
  const safeWidth = Math.max(1, Number(width) || 512);
  const safeHeight = Math.max(1, Number(height) || 512);
  const sx = Math.abs(scale[0]) > 1e-8 ? scale[0] : 0.25;
  const sy = Math.abs(scale[1]) > 1e-8 ? scale[1] : 0.25;
  object.faceTextureScale[faceIndex] = scale;
  object.faceTextureAxisU[faceIndex] = axisU;
  object.faceTextureAxisV[faceIndex] = axisV;
  object.faceTextureSizes[faceIndex] = [safeWidth, safeHeight];
  return face.map(vertexIndex => {
    const p = object.vertices?.[vertexIndex] || [0, 0, 0];
    const uPixels = dot3(p, axisU) / sx + axisU[3];
    const vPixels = dot3(p, axisV) / sy + axisV[3];
    return [uPixels / safeWidth, vPixels / safeHeight];
  });
}

function ensureMappings(object) {
  if (!object || object.type !== 'part' || !object.faces?.length) return object;
  object.faceUVs ??= [];
  object.faceTextureScale ??= [];
  object.faceTextureAxisU ??= [];
  object.faceTextureAxisV ??= [];
  object.faceTextureSizes ??= [];
  for (let i = 0; i < object.faces.length; i++) {
    const face = object.faces[i];
    const axes = defaultAxes(object.vertices, face);
    object.faceTextureScale[i] ??= [...DEFAULT_SCALE];
    object.faceTextureAxisU[i] ??= axes.u;
    object.faceTextureAxisV[i] ??= axes.v;
    object.faceTextureSizes[i] ??= [...DEFAULT_TEXTURE_SIZE];
    if (!Array.isArray(object.faceUVs[i]) || object.faceUVs[i].length !== face.length) {
      const size = object.faceTextureSizes[i];
      object.faceUVs[i] = generateFaceUv(object, i, size?.[0], size?.[1]);
    }
  }
  object.faceUVs.length = object.faces.length;
  object.faceTextureScale.length = object.faces.length;
  object.faceTextureAxisU.length = object.faces.length;
  object.faceTextureAxisV.length = object.faces.length;
  object.faceTextureSizes.length = object.faces.length;
  return object;
}

function enrichFromDocument(doc, object) {
  if (!object?.dmxId || object.type !== 'part') return object;
  const element = VMAP.findElementByDmxId(doc, object.dmxId);
  const meshData = elem(element, 'meshData');
  if (!meshData) return ensureMappings(object);
  const loops = meshLoops(meshData);
  const faceVertexData = elem(meshData, 'faceVertexData');
  const texcoordStream = stream(faceVertexData, 'texcoord:0');
  const texcoordData = ary(texcoordStream, 'data').map(value => numbers(value, 2, 0));
  const faceData = elem(meshData, 'faceData');
  const faceDataIndices = ary(meshData, 'faceDataIndices').map(Number);
  const scaleData = ary(stream(faceData, 'textureScale:0'), 'data');
  const axisUData = ary(stream(faceData, 'textureAxisU:0'), 'data');
  const axisVData = ary(stream(faceData, 'textureAxisV:0'), 'data');
  object.faceUVs = loops.map(loop => loop.dataIndices.map(index => texcoordData[index] ? [...texcoordData[index]] : [0, 0]));
  object.faceTextureScale = loops.map((_, i) => numbers(scaleData[faceDataIndices[i] ?? i] || DEFAULT_SCALE, 2, 0.25));
  object.faceTextureAxisU = loops.map((loop, i) => numbers(axisUData[faceDataIndices[i] ?? i] || defaultAxes(object.vertices, loop.vertices).u, 4, 0));
  object.faceTextureAxisV = loops.map((loop, i) => numbers(axisVData[faceDataIndices[i] ?? i] || defaultAxes(object.vertices, loop.vertices).v, 4, 0));
  object.faceTextureSizes = object.faces.map(() => [...DEFAULT_TEXTURE_SIZE]);
  return ensureMappings(object);
}

function writeMappings(doc, object) {
  if (!object?.dmxId || object.type !== 'part') return;
  ensureMappings(object);
  const element = VMAP.findElementByDmxId(doc, object.dmxId);
  const meshData = elem(element, 'meshData');
  if (!meshData) return;
  const loops = meshLoops(meshData);
  const edgeVertexData = ary(meshData, 'edgeVertexDataIndices').map(Number);
  const maxDataIndex = Math.max(-1, ...edgeVertexData.filter(Number.isFinite));
  const faceVertexData = elem(meshData, 'faceVertexData');
  const texcoords = Array.from({ length: Math.max(maxDataIndex + 1, loops.reduce((sum, loop) => sum + loop.vertices.length, 0)) }, () => [0, 0]);
  loops.forEach((loop, faceIndex) => {
    const source = object.faceUVs?.[faceIndex] || generateFaceUv(object, faceIndex);
    loop.dataIndices.forEach((dataIndex, corner) => {
      if (dataIndex >= 0) texcoords[dataIndex] = numbers(source[corner] || [0, 0], 2, 0);
    });
  });
  setStreamData(faceVertexData, 'texcoord:0', texcoords);
  const faceData = elem(meshData, 'faceData');
  const faceDataIndices = ary(meshData, 'faceDataIndices').map(Number);
  const rowCount = Math.max(loops.length, ...faceDataIndices.map(x => x + 1).filter(Number.isFinite));
  const scales = Array.from({ length: rowCount }, () => [...DEFAULT_SCALE]);
  const axesU = Array.from({ length: rowCount }, () => [1, 0, 0, 0]);
  const axesV = Array.from({ length: rowCount }, () => [0, -1, 0, 0]);
  loops.forEach((loop, faceIndex) => {
    const row = faceDataIndices[faceIndex] ?? faceIndex;
    const axes = defaultAxes(object.vertices, loop.vertices);
    scales[row] = numbers(object.faceTextureScale?.[faceIndex] || DEFAULT_SCALE, 2, 0.25);
    axesU[row] = numbers(object.faceTextureAxisU?.[faceIndex] || axes.u, 4, 0);
    axesV[row] = numbers(object.faceTextureAxisV?.[faceIndex] || axes.v, 4, 0);
  });
  setStreamData(faceData, 'textureScale:0', scales);
  setStreamData(faceData, 'textureAxisU:0', axesU);
  setStreamData(faceData, 'textureAxisV:0', axesV);
}

function setFaceMaterialInfo(object, faceIndices, width, height) {
  if (!object || object.type !== 'part') return;
  ensureMappings(object);
  for (const faceIndex of faceIndices || []) {
    if (!object.faces?.[faceIndex]) continue;
    object.faceTextureScale[faceIndex] = [...DEFAULT_SCALE];
    const axes = defaultAxes(object.vertices, object.faces[faceIndex]);
    object.faceTextureAxisU[faceIndex] = axes.u;
    object.faceTextureAxisV[faceIndex] = axes.v;
    object.faceTextureSizes[faceIndex] = [Math.max(1, width || 512), Math.max(1, height || 512)];
    object.faceUVs[faceIndex] = generateFaceUv(object, faceIndex, width, height);
  }
}

if (VMAP && !VMAP.__hammerFidelityPatched) {
  VMAP.__hammerFidelityPatched = true;
  const originalExtract = VMAP.extractObjects.bind(VMAP);
  const originalAddPart = VMAP.addPart.bind(VMAP);
  const originalApply = VMAP.applyObjectToDocument.bind(VMAP);
  const originalPrepare = VMAP.prepareForSave.bind(VMAP);
  const originalExtrude = VMAP.extrudeFace.bind(VMAP);
  const originalClip = VMAP.clipAxis.bind(VMAP);
  VMAP.extractObjects = doc => originalExtract(doc).map(object => enrichFromDocument(doc, object));
  VMAP.addPart = (doc, options = {}) => ensureMappings(originalAddPart(doc, options));
  VMAP.applyObjectToDocument = (doc, object) => { const result = originalApply(doc, object); if (result && object?.type === 'part') writeMappings(doc, object); return result; };
  VMAP.prepareForSave = (doc, objects) => { const out = originalPrepare(doc, objects); for (const object of objects || []) if (object?.type === 'part') writeMappings(out, object); return out; };
  VMAP.extrudeFace = (object, faceIndex, distance) => { const result = originalExtrude(object, faceIndex, distance); if (result) { object.faceUVs = []; ensureMappings(object); } return result; };
  VMAP.clipAxis = (object, axis, plane, keepPositive) => { const result = originalClip(object, axis, plane, keepPositive); if (result) { object.faceUVs = []; ensureMappings(object); } return result; };
}

async function installViewport(viewport) {
  if (!viewport || viewport.__hammerFidelityViewport) return;
  viewport.__hammerFidelityViewport = true;
  const previousLoadTexture = viewport.loadMaterialTexture.bind(viewport);
  viewport.loadMaterialTexture = async resource => {
    const texture = await previousLoadTexture(resource);
    if (texture) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 1);
      texture.offset.set(0, 0);
      texture.center.set(0, 0);
      texture.rotation = 0;
      texture.needsUpdate = true;
    }
    return texture;
  };
  viewport.createPartVisual = function(object) {
    ensureMappings(object);
    const positions = [], uvs = [], groups = [];
    let cursor = 0;
    for (let faceIndex = 0; faceIndex < object.faces.length; faceIndex++) {
      const face = object.faces[faceIndex];
      const faceUv = object.faceUVs[faceIndex] || generateFaceUv(object, faceIndex);
      if (!face || face.length < 3) continue;
      const start = cursor;
      for (let i = 1; i < face.length - 1; i++) {
        for (const corner of [0, i, i + 1]) {
          const vertex = object.vertices[face[corner]] || [0, 0, 0];
          const uv = faceUv[corner] || [0, 0];
          positions.push(vertex[0], vertex[1], vertex[2]);
          uvs.push(uv[0], uv[1]);
          cursor++;
        }
      }
      if (cursor > start) groups.push({ start, count: cursor - start, materialIndex: faceIndex });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
    const materials = object.faces.map((_, i) => this.createFaceMaterial(object.faceMaterials?.[i] || 'ERROR'));
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.userData.ephVisual = true;
    return mesh;
  };
  const previousEntityMarker = viewport.createEntityMarker.bind(viewport);
  viewport.createEntityMarker = function(object) {
    const className = String(object.className || '');
    const modelPath = className === 'info_player_counterterrorist' ? CT_MODEL : className === 'info_player_terrorist' ? T_MODEL : null;
    if (!modelPath) return previousEntityMarker(object);
    const group = new THREE.Group();
    const placeholder = new THREE.Mesh(new THREE.CapsuleGeometry(16, 36, 6, 10), new THREE.MeshStandardMaterial({ color: className.includes('counterterrorist') ? 0x527da8 : 0x9d7d52, roughness: 0.72 }));
    placeholder.rotation.x = Math.PI / 2;
    group.add(placeholder);
    this.loadModel(modelPath).then(data => {
      if (!data || !group.parent) return;
      const model = cloneSkeleton(data.scene);
      model.rotation.x = Math.PI / 2;
      model.scale.setScalar(data.scale);
      group.remove(placeholder);
      placeholder.geometry.dispose();
      placeholder.material.dispose();
      group.add(model);
      if (this.selectedId === object.id) this.updateSelectionBox();
    });
    return group;
  };
  if (viewport.objects?.length) {
    viewport.objects.forEach(ensureMappings);
    viewport.setObjects(viewport.objects, viewport.selectedId);
  }
}

window.EPH_HAMMER_FIDELITY = { ensureMappings, setFaceMaterialInfo, writeMappings, generateFaceUv, CT_MODEL, T_MODEL };
if (window.EPH3D) installViewport(window.EPH3D);
window.addEventListener('eph3d-ready', event => installViewport(event.detail));
