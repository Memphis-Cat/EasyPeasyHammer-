// byanca
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const VMAP = window.EPH_VMAP;
const FACE_NAMES = ['right', 'left', 'front', 'back', 'top', 'bottom'];
const CT_MODEL = 'agents/models/ctm_sas/ctm_sas.vmdl';
const T_MODEL = 'agents/models/tm_phoenix/tm_phoenix.vmdl';
const CT_FALLBACK = 'characters/models/ctm_sas/ctm_sas.vmdl';
const T_FALLBACK = 'characters/models/tm_phoenix/tm_phoenix.vmdl';

function semanticFaceName(vertices, face) {
  const normal = VMAP.faceNormal(vertices || [], face || []);
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (az >= ax && az >= ay) return normal[2] >= 0 ? 'top' : 'bottom';
  if (ax >= ay) return normal[0] >= 0 ? 'right' : 'left';
  return normal[1] <= 0 ? 'front' : 'back';
}

function reorderFaceArray(array, order) {
  if (!Array.isArray(array) || array.length < order.length) return array;
  return order.map(index => array[index]);
}

function normalizePlacedBox(object, desiredMaterials = null) {
  if (!object || object.type !== 'part' || object.faces?.length !== 6) return object;
  const byName = new Map();
  object.faces.forEach((face, index) => {
    const name = semanticFaceName(object.vertices, face);
    if (!byName.has(name)) byName.set(name, index);
  });
  if (!FACE_NAMES.every(name => byName.has(name))) return object;

  const order = FACE_NAMES.map(name => byName.get(name));
  object.faces = reorderFaceArray(object.faces, order);
  object.faceMaterials = reorderFaceArray(object.faceMaterials, order) || [];
  object.faceUVs = reorderFaceArray(object.faceUVs, order) || [];
  object.faceTextureScale = reorderFaceArray(object.faceTextureScale, order) || [];
  object.faceTextureAxisU = reorderFaceArray(object.faceTextureAxisU, order) || [];
  object.faceTextureAxisV = reorderFaceArray(object.faceTextureAxisV, order) || [];
  object.faceTextureSizes = reorderFaceArray(object.faceTextureSizes, order) || [];

  if (desiredMaterials) {
    object.faceMaterials = FACE_NAMES.map((name, index) => desiredMaterials[name] || object.faceMaterials[index] || 'ERROR');
  }
  object.materials ||= {};
  FACE_NAMES.forEach((name, index) => {
    object.materials[name] = object.faceMaterials[index] || object.faceMaterials[0] || 'ERROR';
  });
  return object;
}

if (VMAP && !VMAP.__ephSemanticPartOrder) {
  VMAP.__ephSemanticPartOrder = true;
  const previousAddPart = VMAP.addPart.bind(VMAP);
  VMAP.addPart = (doc, options = {}) => {
    const object = previousAddPart(doc, options);
    const desired = options.materials || null;
    normalizePlacedBox(object, desired);
    VMAP.applyObjectToDocument(doc, object);
    return object;
  };
}

function cloneLoadedModel(data) {
  const model = cloneSkeleton(data.scene);
  model.rotation.x = Math.PI / 2;
  model.scale.setScalar(data.scale);
  model.traverse(child => {
    if (!child.isMesh) return;
    child.geometry = child.geometry?.clone?.() || child.geometry;
    if (Array.isArray(child.material)) child.material = child.material.map(material => material?.clone?.() || material);
    else if (child.material?.clone) child.material = child.material.clone();
    child.castShadow = false;
    child.receiveShadow = false;
  });
  return model;
}

async function installViewport(viewport) {
  if (!viewport || viewport.__ephFidelityV2) return;
  viewport.__ephFidelityV2 = true;
  viewport.readyModelCache ||= new Map();

  const previousLoadModel = viewport.loadModel.bind(viewport);
  viewport.loadModel = async function(resource) {
    if (!resource) return null;
    if (this.readyModelCache.has(resource)) return this.readyModelCache.get(resource);
    const data = await previousLoadModel(resource);
    if (data) this.readyModelCache.set(resource, data);
    return data;
  };

  viewport.warmModels = async function(resources) {
    const unique = [...new Set((resources || []).filter(Boolean))];
    await Promise.allSettled(unique.map(resource => this.loadModel(resource)));
  };

  const previousPropVisual = viewport.createPropVisual.bind(viewport);
  viewport.createPropVisual = function(object, root) {
    const ready = object?.model ? this.readyModelCache.get(object.model) : null;
    if (!ready) return previousPropVisual(object, root);
    const group = new THREE.Group();
    group.userData.ephVisual = true;
    group.add(cloneLoadedModel(ready));
    return group;
  };

  const previousEntityMarker = viewport.createEntityMarker.bind(viewport);
  viewport.createEntityMarker = function(object) {
    const className = String(object.className || '');
    const primary = className === 'info_player_counterterrorist' ? CT_MODEL : className === 'info_player_terrorist' ? T_MODEL : null;
    if (!primary) return previousEntityMarker(object);

    const fallback = className === 'info_player_counterterrorist' ? CT_FALLBACK : T_FALLBACK;
    const group = new THREE.Group();
    const placeholder = new THREE.Mesh(
      new THREE.CapsuleGeometry(16, 36, 6, 10),
      new THREE.MeshStandardMaterial({ color: className === 'info_player_counterterrorist' ? 0x527da8 : 0x9d7d52, roughness: 0.72 })
    );
    placeholder.rotation.x = Math.PI / 2;
    placeholder.userData.ephAgentPlaceholder = true;
    group.add(placeholder);

    const attach = async () => {
      let data = await this.loadModel(primary);
      if (!data) data = await this.loadModel(fallback);
      if (!data || !group.parent) return;
      const model = cloneLoadedModel(data);
      group.remove(placeholder);
      placeholder.geometry?.dispose?.();
      placeholder.material?.dispose?.();
      group.add(model);
      if (this.selectedId === object.id) this.updateSelectionBox();
    };
    attach();
    return group;
  };

  const previousSetObjects = viewport.setObjects.bind(viewport);
  viewport.setObjects = function(objects, selectedId = null) {
    const modelPaths = [];
    for (const object of objects || []) {
      if (object?.type === 'prop' && object.model) modelPaths.push(object.model);
      if (object?.className === 'info_player_counterterrorist') modelPaths.push(CT_MODEL);
      if (object?.className === 'info_player_terrorist') modelPaths.push(T_MODEL);
    }
    this.warmModels(modelPaths);
    return previousSetObjects(objects, selectedId);
  };

  if (viewport.objects?.length) {
    viewport.setObjects(viewport.objects, viewport.selectedId);
  }

  try {
    const startup = await window.easyPeasyHammer?.getStartupState?.();
    const source = startup?.lastSession?.uiState?.vmapText;
    if (source) {
      const doc = VMAP.parse(source);
      const objects = VMAP.extractObjects(doc);
      const modelPaths = objects.filter(object => object?.type === 'prop' && object.model).map(object => object.model);
      if (objects.some(object => object?.className === 'info_player_counterterrorist')) modelPaths.push(CT_MODEL);
      if (objects.some(object => object?.className === 'info_player_terrorist')) modelPaths.push(T_MODEL);
      viewport.warmModels(modelPaths);
    }
  } catch {}
}

window.EPH_FIDELITY_V2 = { semanticFaceName, normalizePlacedBox, CT_MODEL, T_MODEL };
if (window.EPH3D) installViewport(window.EPH3D);
window.addEventListener('eph3d-ready', event => installViewport(event.detail));
