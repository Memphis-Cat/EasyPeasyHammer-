// byanca
import * as THREE from 'three';

const api = window.easyPeasyHammer;

function projectFolderKey() {
  return S.project?.vmapPath ? `eph-folders:${S.project.vmapPath}` : null;
}

function persistFolders() {
  const key = projectFolderKey();
  if (!key) return;
  const folders = (S.objects || []).filter(object => object.type === 'folder').map(folder => ({
    id: folder.id,
    name: folder.name,
    parent: folder.parent || 'world',
    expanded: folder.expanded !== false
  }));
  const parents = Object.fromEntries((S.objects || []).filter(object => object.dmxId && object.parent && object.parent !== 'world').map(object => [object.id, object.parent]));
  localStorage.setItem(key, JSON.stringify({ folders, parents }));
}

function installFolderFixes() {
  if (window.__ephAuditFolderFixes) return;
  window.__ephAuditFolderFixes = true;

  const rawRemoveSelected = removeSelected;
  removeSelected = function() {
    const object = current();
    if (object?.type !== 'folder') return rawRemoveSelected();
    const id = object.id;
    for (const child of S.objects) if (child.parent === id) child.parent = object.parent || 'world';
    S.objects = S.objects.filter(item => item.id !== id);
    S.selectedId = 'world';
    persistFolders();
    renderTree();
    renderProperties();
    S.viewport?.select?.('world', false);
    markDirty(`Deleted ${object.name}`);
  };

  document.addEventListener('change', event => {
    if (event.target?.id !== 'objectName') return;
    const object = current();
    if (object?.type !== 'folder') return;
    setTimeout(() => {
      persistFolders();
      window.EPH_COLLAB?.scheduleSnapshot?.(0);
    }, 0);
  }, true);

  document.addEventListener('click', event => {
    if (event.target?.id !== 'addSceneFolder') return;
    setTimeout(() => {
      persistFolders();
      window.EPH_COLLAB?.scheduleSnapshot?.(0);
    }, 0);
  }, true);
}

function installSharedFolderRestoreFix() {
  if (typeof loadProject !== 'function' || loadProject.__ephAuditSharedFolders) return;
  const rawLoadProject = loadProject;
  loadProject = async function(project, ui) {
    const result = await rawLoadProject(project, ui);
    if (result && (Array.isArray(ui?.ephFolders) || ui?.ephParents)) {
      // advanced-ui's local folder restore runs on a short timer. Re-apply the
      // authoritative shared grouping after that pass so an empty local cache
      // cannot erase the collaboration folders.
      setTimeout(() => {
        window.EPH_APPLY_SHARED_FOLDERS?.(ui);
        persistFolders();
      }, 180);
    }
    return result;
  };
  loadProject.__ephAuditSharedFolders = true;
  window.loadProject = loadProject;
}

function installRotateSnapSync() {
  if (renderViewportControls.__ephAuditRotateSync) return;
  const rawRender = renderViewportControls;
  renderViewportControls = function() {
    const result = rawRender();
    const select = document.getElementById('rotateSnapSelect');
    if (select && [...select.options].some(option => Number(option.value) === Number(S.angleSnap))) {
      select.value = String(S.angleSnap);
    }
    return result;
  };
  renderViewportControls.__ephAuditRotateSync = true;
  renderViewportControls();
}

function fixDecalMaterials(root) {
  root?.traverse?.(child => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      material.transparent = true;
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  });
}

function installDecalDepthFix(viewport) {
  if (!viewport || viewport.__ephAuditDecals) return;
  viewport.__ephAuditDecals = true;
  const rawCreateRoot = viewport.createObjectRoot.bind(viewport);
  viewport.createObjectRoot = function(object) {
    const root = rawCreateRoot(object);
    if (object?.type === 'decal') fixDecalMaterials(root);
    return root;
  };
  for (const object of S.objects || []) if (object.type === 'decal') viewport.updateObject(object);
}

function terrainGridSize(object) {
  const side = Math.round(Math.sqrt(object?.vertices?.length || 0));
  return side >= 3 && side * side === object.vertices.length ? side - 1 : null;
}

function bilinearPoint(vertices, n, u, v) {
  const x = Math.max(0, Math.min(n, u * n));
  const y = Math.max(0, Math.min(n, v * n));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(n, x0 + 1), y1 = Math.min(n, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const at = (sx, sy) => vertices[sy * (n + 1) + sx] || [0, 0, 0];
  const a = at(x0, y0), b = at(x1, y0), c = at(x0, y1), d = at(x1, y1);
  return [0, 1, 2].map(axis => {
    const top = a[axis] * (1 - tx) + b[axis] * tx;
    const bottom = c[axis] * (1 - tx) + d[axis] * tx;
    return top * (1 - ty) + bottom * ty;
  });
}

function resubdivideTerrain(object, target) {
  const sourceN = terrainGridSize(object);
  const n = Math.max(2, Math.min(64, Math.round(Number(target) || 16)));
  if (!sourceN) return false;
  const source = object.vertices.map(vertex => [...vertex]);
  const vertices = [];
  const faces = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) vertices.push(bilinearPoint(source, sourceN, x / n, y / n));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x;
    faces.push([a, a + 1, a + n + 2, a + n + 1]);
  }
  const material = object.faceMaterials?.[0] || 'materials/dev/dev_measuregeneric01b.vmat';
  object.vertices = vertices;
  object.faces = faces;
  object.faceMaterials = faces.map(() => material);
  object.size = VMAP.geometryBounds(vertices).size;
  return true;
}

function installTerrainResubdivisionFix() {
  document.addEventListener('click', event => {
    if (event.target?.id !== 'ephRebuildTerrain') return;
    const object = current();
    if (object?.type !== 'terrain') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const select = document.getElementById('ephTerrainSubdivisions');
    pushHistory();
    if (!resubdivideTerrain(object, select?.value)) {
      S.undo.pop();
      toast('This terrain can no longer be automatically resubdivided.');
      return;
    }
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport?.updateObject(object);
    markDirty(`Rebuilt subdivisions on ${object.name}`);
    renderProperties();
  }, true);
}

function installSurfaceSnapHardening(viewport) {
  if (!viewport || viewport.__ephAuditSurfaceSnap) return;
  viewport.__ephAuditSurfaceSnap = true;
  let drag = null;

  viewport.transform.addEventListener('dragging-changed', event => {
    if (!event.value || viewport.tool !== 'move' || !viewport.surfaceSnap) { drag = null; return; }
    const root = viewport.objectRoots.get(viewport.selectedId);
    if (!root) return;
    drag = { previousBottom: new THREE.Box3().setFromObject(root).min.z };
  });

  viewport.transform.addEventListener('objectChange', () => {
    if (!drag || viewport.tool !== 'move' || !viewport.surfaceSnap) return;
    const root = viewport.objectRoots.get(viewport.selectedId);
    if (!root) return;
    let box = new THREE.Box3().setFromObject(root);
    const currentBottom = box.min.z;
    const previousBottom = drag.previousBottom;
    const snapDistance = Math.max(2, Math.min(48, (Number(viewport.moveSnap) || 1) * 2));
    const candidates = [...viewport.objectRoots.entries()]
      .filter(([id]) => id !== viewport.selectedId)
      .filter(([id]) => ['part', 'terrain', 'prop'].includes(viewport.getObjectById(id)?.type))
      .map(([, candidate]) => candidate);
    if (!candidates.length) { drag.previousBottom = currentBottom; return; }

    const insetX = Math.min(1, Math.max(0, (box.max.x - box.min.x) * .02));
    const insetY = Math.min(1, Math.max(0, (box.max.y - box.min.y) * .02));
    const xs = [box.min.x + insetX, (box.min.x + box.max.x) / 2, box.max.x - insetX];
    const ys = [box.min.y + insetY, (box.min.y + box.max.y) / 2, box.max.y - insetY];
    const originZ = Math.max(previousBottom + .5, currentBottom + snapDistance);
    const far = Math.max(snapDistance + 1, previousBottom - currentBottom + snapDistance + 1);
    let bestZ = -Infinity;

    for (const x of xs) for (const y of ys) {
      viewport.raycaster.set(new THREE.Vector3(x, y, originZ), new THREE.Vector3(0, 0, -1));
      viewport.raycaster.far = far;
      const hit = viewport.raycaster.intersectObjects(candidates, true)[0];
      if (!hit) continue;
      const z = hit.point.z;
      const crossed = previousBottom >= z - .01 && currentBottom <= z + .01;
      const near = currentBottom >= z && currentBottom - z <= snapDistance;
      if ((crossed || near) && z > bestZ) bestZ = z;
    }

    if (Number.isFinite(bestZ)) {
      root.position.z += bestZ - currentBottom + .02;
      viewport.syncSelectedFromRoot(false);
      viewport.updateSelectionBox();
      box = new THREE.Box3().setFromObject(root);
    }
    drag.previousBottom = box.min.z;
  });
}

function installCollaborationCleanup() {
  if (window.__ephAuditCollabCleanup) return;
  window.__ephAuditCollabCleanup = true;
  api?.onCollaborationEvent?.(event => {
    const collab = window.EPH_COLLAB;
    if (!collab || !event) return;
    if (event.type === 'peer-left' && event.peerId) {
      collab.remoteSelections?.delete(event.peerId);
      collab.remoteCursors?.delete(event.peerId);
    } else if (event.type === 'disconnected' || event.type === 'kicked') {
      collab.remoteSelections?.clear();
      collab.remoteCursors?.clear();
    }
  });
}

function installCollaborationErrorGuards() {
  const collab = window.EPH_COLLAB;
  if (!collab || collab.__ephAuditErrorGuards) return false;
  collab.__ephAuditErrorGuards = true;
  for (const method of ['host', 'join']) {
    const raw = collab[method];
    if (typeof raw !== 'function') continue;
    collab[method] = async (...args) => {
      try { return await raw(...args); }
      catch (error) { return { ok: false, error: error?.message || `Could not ${method} collaboration.` }; }
    };
  }
  return true;
}

function installBottomPlaceholderFix() {
  if (renderBottom.__ephAuditBottom) return;
  const rawRenderBottom = renderBottom;
  renderBottom = function() {
    const result = rawRenderBottom();
    if (S.bottomTab === 'collaborators' && !window.EPH_COLLAB_RENDER) {
      const host = document.getElementById('bottomContent');
      if (host) host.innerHTML = '<div class="collab-state">Collaboration is ready. Start a session or join with an invite code.</div>';
    }
    return result;
  };
  renderBottom.__ephAuditBottom = true;
}

function syncEarlyUi() {
  const invite = document.getElementById('ephInviteCode');
  if (invite) invite.maxLength = 4096;
  const rotate = document.getElementById('rotateSnapSelect');
  if (rotate && [...rotate.options].some(option => Number(option.value) === Number(S.angleSnap))) rotate.value = String(S.angleSnap);
}

function install(viewport = S.viewport || window.EPH3D) {
  if (window.__ephAuditFixesV8) return;
  window.__ephAuditFixesV8 = true;
  installFolderFixes();
  installSharedFolderRestoreFix();
  installRotateSnapSync();
  installTerrainResubdivisionFix();
  installCollaborationCleanup();
  installBottomPlaceholderFix();
  if (viewport) {
    installDecalDepthFix(viewport);
    installSurfaceSnapHardening(viewport);
  }
  syncEarlyUi();
  const timer = setInterval(() => {
    syncEarlyUi();
    if (installCollaborationErrorGuards()) clearInterval(timer);
  }, 120);
  setTimeout(() => clearInterval(timer), 10000);
}

install();
window.addEventListener('eph3d-ready', event => {
  installDecalDepthFix(event.detail);
  installSurfaceSnapHardening(event.detail);
});
