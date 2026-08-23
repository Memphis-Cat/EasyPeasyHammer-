// byanca
import * as THREE from 'three';

const COPY_TYPES = new Set(['part', 'decal', 'terrain', 'entity', 'prop']);
const MESH_TYPES = new Set(['part', 'decal', 'terrain']);
let editorClipboard = null;
let surfaceDrag = null;

const clone = value => {
  try { return structuredClone(value); }
  catch { return JSON.parse(JSON.stringify(value)); }
};

function editableTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], dialog'));
}

function copySelected() {
  const object = current?.();
  if (!object || !COPY_TYPES.has(object.type)) return false;
  editorClipboard = clone(object);
  toast?.(`Copied ${object.name || object.type}`);
  return true;
}

function meshName(type) {
  const stamp = Date.now();
  if (type === 'decal') return `EPH_DECAL_${stamp}`;
  if (type === 'terrain') return `EPH_TERRAIN_${stamp}`;
  return 'meshData';
}

function nextCopyName(source) {
  const base = String(source.name || source.type || 'Object').replace(/_Copy(?:_\d+)?$/i, '');
  let name = `${base}_Copy`;
  let index = 2;
  const used = new Set((S.objects || []).map(object => object.name));
  while (used.has(name)) name = `${base}_Copy_${index++}`;
  return name;
}

function pasteSelected() {
  const source = editorClipboard;
  if (!source || !COPY_TYPES.has(source.type) || !S.doc) return false;
  pushHistory();
  const position = [...(source.position || [0, 0, 0])];
  position[0] += 16;
  position[1] += 16;
  let object;

  if (MESH_TYPES.has(source.type)) {
    object = ensureObject(VMAP.addPart(S.doc, {
      vertices: clone(source.vertices || []),
      faces: clone(source.faces || []),
      faceMaterials: clone(source.faceMaterials || []),
      materials: clone(source.materials || {}),
      position,
      rotation: clone(source.rotation || [0, 0, 0]),
      scale: clone(source.scale || [1, 1, 1]),
      collision: source.type === 'decal' ? false : source.collision !== false,
      meshName: meshName(source.type),
    }));
    object.type = source.type;
  } else {
    object = ensureObject(VMAP.addEntity(S.doc, {
      className: source.className || (source.type === 'prop' ? 'prop_static' : 'info_target'),
      model: source.model || '',
      name: nextCopyName(source),
      position,
      rotation: clone(source.rotation || [0, 0, 0]),
      scale: clone(source.scale || [1, 1, 1]),
      collision: source.collision !== false,
      entityProperties: clone(source.entityProperties || {}),
    }));
    object.type = source.type;
  }

  object.name = nextCopyName(source);
  object.parent = S.objects.some(item => item.id === source.parent) ? source.parent : 'world';
  object.visible = source.visible !== false;
  object.collision = source.type === 'decal' ? false : source.collision !== false;
  object.blockPlayers = source.type === 'decal' ? false : Boolean(source.blockPlayers);
  object.blockGrenades = source.type === 'decal' ? false : Boolean(source.blockGrenades);
  object.blockBullets = source.type === 'decal' ? false : Boolean(source.blockBullets);
  if (source.faceTextureScale) object.faceTextureScale = clone(source.faceTextureScale);
  if (source.faceTextureAxisU) object.faceTextureAxisU = clone(source.faceTextureAxisU);
  if (source.faceTextureAxisV) object.faceTextureAxisV = clone(source.faceTextureAxisV);
  if (source.faceTextureSizes) object.faceTextureSizes = clone(source.faceTextureSizes);
  if (source.faceUVs) object.faceUVs = clone(source.faceUVs);

  VMAP.applyObjectToDocument(S.doc, object);
  S.objects.push(object);
  S.selectedId = object.id;
  S.selectedFaces = new Set([0]);
  S.viewport.objects = S.objects;
  S.viewport.updateObject(object);
  S.viewport.select(object.id, false);
  setTool('move');
  renderTree();
  renderProperties();
  markDirty(`Pasted ${object.name}`);
  return true;
}

function installClipboardAndReload() {
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || editableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 'c') {
      if (copySelected()) event.preventDefault();
    } else if (key === 'v') {
      if (pasteSelected()) event.preventDefault();
    } else if (key === 'r') {
      event.preventDefault();
      window.EPH_COLLAB?.sendSnapshotNow?.();
      setTimeout(() => location.reload(), 25);
    }
  }, true);
}

function nearCameraPosition() {
  const viewport = S.viewport;
  if (!viewport?.camera || !viewport?.orbit) return [0, 0, 64];
  const direction = viewport.orbit.target.clone().sub(viewport.camera.position);
  if (direction.lengthSq() < .00001) direction.set(0, 1, 0);
  direction.normalize();
  const point = viewport.camera.position.clone().add(direction.multiplyScalar(224));
  const snap = viewport.snap ? Math.max(.1, Number(viewport.moveSnap) || 1) : .1;
  return [point.x, point.y, point.z].map(value => Math.round(value / snap) * snap);
}

function installPartPlacement() {
  if (addPart.__ephNearCamera) return;
  const rawAddPart = addPart;
  addPart = function() {
    const result = rawAddPart();
    const object = current?.();
    if (!object || object.type !== 'part') return result;
    object.position = nearCameraPosition();
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport?.updateObject(object);
    renderProperties();
    markDirty(`Placed ${object.name} near camera`);
    return result;
  };
  addPart.__ephNearCamera = true;
}

function installShiftMaterial() {
  const grid = document.getElementById('assetGrid');
  if (!grid || grid.dataset.ephShiftMaterial === '1') return;
  grid.dataset.ephShiftMaterial = '1';
  grid.addEventListener('click', event => {
    if (!event.shiftKey || S.assetTab !== 'materials') return;
    const object = current?.();
    if (!object || !MESH_TYPES.has(object.type)) return;
    const card = event.target.closest('.asset-card');
    if (!card) return;
    const item = S.assetItems?.[Number(card.dataset.i)];
    if (!item?.path) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    S.selectedFaces = new Set(Array.from({ length: object.faces?.length || 1 }, (_, index) => index));
    applyMaterial(item.path);
  }, true);
}

function installSurfaceSnap() {
  const viewport = S.viewport;
  if (!viewport || viewport.__ephSurfaceSnapV7) return;
  viewport.__ephSurfaceSnapV7 = true;
  viewport.surfaceSnap = localStorage.getItem('eph-surface-snap') === '1';

  const moveHost = document.getElementById('ephMoveSnap')?.parentElement;
  if (moveHost && !document.getElementById('ephSurfaceSnap')) {
    const button = document.createElement('button');
    button.id = 'ephSurfaceSnap';
    button.type = 'button';
    button.className = `eph-surface-toggle${viewport.surfaceSnap ? ' active' : ''}`;
    button.textContent = 'Surface';
    button.title = 'Prevent moved objects from passing downward through top surfaces';
    button.onclick = () => {
      viewport.surfaceSnap = !viewport.surfaceSnap;
      localStorage.setItem('eph-surface-snap', viewport.surfaceSnap ? '1' : '0');
      button.classList.toggle('active', viewport.surfaceSnap);
    };
    moveHost.appendChild(button);
  }

  viewport.transform.addEventListener('dragging-changed', event => {
    if (!event.value || viewport.tool !== 'move' || !viewport.surfaceSnap) { surfaceDrag = null; return; }
    const root = viewport.objectRoots.get(viewport.selectedId);
    if (!root) return;
    const box = new THREE.Box3().setFromObject(root);
    surfaceDrag = { previousBottom: box.min.z };
  });

  viewport.transform.addEventListener('objectChange', () => {
    if (!surfaceDrag || viewport.tool !== 'move' || !viewport.surfaceSnap) return;
    const root = viewport.objectRoots.get(viewport.selectedId);
    if (!root) return;
    let box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const currentBottom = box.min.z;
    const previousBottom = surfaceDrag.previousBottom;
    const others = [...viewport.objectRoots.entries()].filter(([id]) => id !== viewport.selectedId).map(([, value]) => value);
    if (!others.length) { surfaceDrag.previousBottom = currentBottom; return; }

    const crossingDistance = Math.max(0, previousBottom - currentBottom);
    const snapDistance = Math.max(2, Math.min(32, (Number(viewport.moveSnap) || 1) * 2));
    const originZ = Math.max(previousBottom + .5, currentBottom + snapDistance);
    viewport.raycaster.set(new THREE.Vector3(center.x, center.y, originZ), new THREE.Vector3(0, 0, -1));
    viewport.raycaster.far = crossingDistance + snapDistance + 1;
    const hit = viewport.raycaster.intersectObjects(others, true).find(item => item.point.z <= originZ + .001);
    if (hit) {
      const crossed = previousBottom >= hit.point.z - .01 && currentBottom <= hit.point.z + .01;
      const near = currentBottom >= hit.point.z && currentBottom - hit.point.z <= snapDistance;
      if (crossed || near) {
        root.position.z += hit.point.z - currentBottom + .02;
        viewport.syncSelectedFromRoot(false);
        box = new THREE.Box3().setFromObject(root);
      }
    }
    surfaceDrag.previousBottom = box.min.z;
  });
}

function captionFor(button) {
  const map = {
    toolbarNew: 'New', toolbarOpen: 'Open', toolbarSave: 'Save', toolbarSaveAll: 'Save All',
    toolbarDuplicate: 'Duplicate', toolbarUndo: 'Undo', toolbarRedo: 'Redo'
  };
  if (map[button.id]) return map[button.id];
  if (button.classList.contains('view-option')) {
    return ({ bounds: 'Bounds', effects: 'Effects', lock: 'Lock', camera: 'Camera', grid1: 'Grid 1', grid2: 'Grid 2', grid3: 'Grid 3' })[button.dataset.viewOption] || 'View';
  }
  if (button.classList.contains('viewport-icon')) {
    const image = button.querySelector('img')?.getAttribute('src') || '';
    if (image.includes('layout')) return 'Layout';
    if (image.includes('grid_mode')) return 'Grid Mode';
    if (image.includes('more')) return 'More';
  }
  return button.title || '';
}

function installIconCaptions() {
  const buttons = document.querySelectorAll('.toolbar-row .icon-button, .viewport-top-right .viewport-icon');
  for (const button of buttons) {
    if (button.querySelector('.eph-icon-caption')) continue;
    const text = captionFor(button);
    if (!text) continue;
    const caption = document.createElement('span');
    caption.className = 'eph-icon-caption';
    caption.textContent = text;
    button.appendChild(caption);
  }
}

function cleanUi() {
  for (const menu of ['buildMenu', 'windowMenu', 'helpMenu']) {
    document.querySelector(`.menu-button[data-menu="${menu}"]`)?.remove();
    document.getElementById(menu)?.remove();
  }
  document.querySelector('[data-bottom-tab="build"]')?.remove();
  if (S.bottomTab === 'build') {
    S.bottomTab = 'console';
    renderBottom?.();
  }
}

function install() {
  if (!window.EPH3D || window.__ephEditorUxV7) return;
  window.__ephEditorUxV7 = true;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'editor-ux-v7.css';
  document.head.appendChild(style);
  installClipboardAndReload();
  installPartPlacement();
  installShiftMaterial();
  installSurfaceSnap();
  installIconCaptions();
  cleanUi();
}

if (window.EPH3D) install();
window.addEventListener('eph3d-ready', install, { once: true });
