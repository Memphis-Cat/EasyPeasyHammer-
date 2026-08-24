// byanca
(() => {
  'use strict';
  if (window.__ephEditorInteractionConsistencyV50) return;
  window.__ephEditorInteractionConsistencyV50 = true;

  const DEFAULT_DECAL_MATERIAL = 'materials/dev/dev_measuregeneric01b.vmat';
  const DECAL_OFFSET = 0.06;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewport = () => window.EPH3D || state()?.viewport || null;
  const THREE = () => window.EPH_THREE || window.THREE;
  const VMAP = window.EPH_VMAP;
  const objectFor = id => state()?.objects?.find(object => object?.id === id) || null;

  let treeFrame = 0;
  let treeObserver = null;

  function selectedIds() {
    const s = state();
    const vp = viewport();
    const result = [];
    const add = id => {
      if (!id || result.includes(id)) return;
      const object = objectFor(id);
      if (!object || ['world', 'folder'].includes(object.type) || object.visible === false) return;
      result.push(id);
    };

    try { for (const id of window.EPH_MULTI_SELECTION?.ids?.() || []) add(id); } catch {}
    for (const id of Array.isArray(s?.multiSelectedIds) ? s.multiSelectedIds : []) add(id);
    for (const id of Array.isArray(vp?.multiSelectedIds) ? vp.multiSelectedIds : []) add(id);
    add(s?.selectedId || vp?.selectedId);
    return result;
  }

  function visibleTreeObjects() {
    const s = state();
    if (!s) return [];
    const query = String(document.getElementById('sceneSearch')?.value || '').trim().toLowerCase();
    const objects = s.objects || [];
    const byParent = new Map();
    for (const object of objects) {
      const parent = object.parent == null ? null : object.parent;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(object);
    }
    const children = id => byParent.get(id) || [];
    const include = object => {
      const kids = children(object.id);
      return !query
        || String(object.name || '').toLowerCase().includes(query)
        || kids.some(child => String(child.name || '').toLowerCase().includes(query));
    };
    const result = [];
    const walk = object => {
      if (!include(object)) return;
      result.push(object);
      if (object.expanded) for (const child of children(object.id)) walk(child);
    };
    for (const object of byParent.get(null) || []) walk(object);
    return result;
  }

  function syncSceneTreeNow() {
    treeFrame = 0;
    const s = state();
    const tree = document.getElementById('sceneTree');
    if (!s || !tree) return;

    const selected = new Set(selectedIds());
    const visible = visibleTreeObjects();
    const rows = [...tree.querySelectorAll('.tree-row')];

    rows.forEach((row, index) => {
      // renderTree rebuilds rows without ids. Always rewrite the id from the
      // current hierarchy order instead of keeping a stale dataset from a
      // previous render/search/folder state.
      const object = visible[index] || null;
      if (object?.id) row.dataset.objectId = object.id;
      else delete row.dataset.objectId;

      const id = object?.id || '';
      const multiSelected = Boolean(id && selected.has(id));
      const primary = Boolean(id && id === s.selectedId);
      row.classList.toggle('selected', primary);
      row.classList.toggle('eph-multi-selected', multiSelected);
      row.classList.toggle('eph-multi-primary', multiSelected && primary);
      row.classList.toggle('eph-negative-part-row', Boolean(object?.type === 'part' && object.ephNegative));
    });
  }

  function scheduleSceneTree() {
    if (treeFrame) return;
    treeFrame = requestAnimationFrame(syncSceneTreeNow);
  }

  function installTreeSync() {
    const tree = document.getElementById('sceneTree');
    if (!tree) return false;
    if (!treeObserver) {
      treeObserver = new MutationObserver(scheduleSceneTree);
      treeObserver.observe(tree, { childList: true, subtree: true });
    }
    scheduleSceneTree();
    return true;
  }

  function meshSelection() {
    const ids = selectedIds();
    return ids
      .map(objectFor)
      .filter(object => object && ['part', 'terrain', 'decal'].includes(object.type));
  }

  function applyMaterialToObject(object, path, allFaces) {
    if (!object) return;
    try { ensureObject?.(object); } catch {}
    object.faceMaterials ||= [];
    const faceCount = Math.max(object.faces?.length || 0, object.faceMaterials.length || 0, 1);
    const indices = allFaces
      ? Array.from({ length: faceCount }, (_, index) => index)
      : [...(state()?.selectedFaces || new Set([0]))];

    for (const index of indices) {
      if (index < 0 || index >= faceCount) continue;
      object.faceMaterials[index] = path;
    }

    object.materials ||= {};
    for (let index = 0; index < (VMAP?.FACE_NAMES?.length || 0); index++) {
      const name = VMAP.FACE_NAMES[index];
      object.materials[name] = object.faceMaterials[index] || object.faceMaterials[0] || 'ERROR';
    }
    VMAP?.applyObjectToDocument?.(state()?.doc, object);
    viewport()?.updateObject?.(object);
  }

  function installMultiMaterialApply() {
    if (typeof applyMaterial !== 'function' || applyMaterial.__ephMultiMaterialV50) return false;
    const previous = applyMaterial;
    const wrapped = function(path) {
      const targets = meshSelection();
      if (!targets.length) return previous(path);

      // Keep the original face-specific behavior for a single normal Part.
      // A logical multi-selection means "material these Parts", so every face
      // of every selected mesh receives the chosen material in one history step.
      if (targets.length === 1 && targets[0].type === 'part') return previous(path);

      try { pushHistory?.(); } catch {}
      const allFaces = targets.length > 1 || targets[0].type !== 'part';
      for (const object of targets) applyMaterialToObject(object, path, allFaces);
      try { markDirty?.(`Applied ${path} to ${targets.length} selected object${targets.length === 1 ? '' : 's'}`); } catch {}
      try { renderProperties?.(); } catch {}
      try { window.EPH_MULTI_SELECTION?.refresh?.(); } catch {}
      scheduleSceneTree();
      return true;
    };
    wrapped.__ephMultiMaterialV50 = true;
    wrapped.__ephPrevious = previous;
    applyMaterial = wrapped;
    window.applyMaterial = wrapped;
    return true;
  }

  function surfaceCandidate(object) {
    if (!object || object.visible === false || object.type === 'decal' || object.ephNegative) return false;
    if (['part', 'terrain', 'prop'].includes(object.type)) return true;
    return object.type === 'entity' && Boolean(object.ephMeshEntity || object.ephMeshChildIds?.length);
  }

  function centerSurfaceHit(vp) {
    const T = THREE();
    if (!T || !vp?.camera || !vp?.raycaster) return null;
    const roots = [];
    for (const [id, root] of vp.objectRoots || []) {
      if (!root?.visible || !surfaceCandidate(objectFor(id))) continue;
      roots.push(root);
    }
    if (!roots.length) return null;

    vp.raycaster.setFromCamera(new T.Vector2(0, 0), vp.camera);
    const hits = vp.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (!hit?.point || !hit?.object || hit.object.userData?.ephSelectionHighlight || hit.object.userData?.ephTransformGizmo) continue;
      let normal = null;
      if (hit.face?.normal) {
        normal = hit.face.normal.clone();
        try { normal.applyMatrix3(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize(); } catch {}
      }
      if (!normal || normal.lengthSq() < 1e-8) normal = vp.camera.getWorldDirection(new T.Vector3()).multiplyScalar(-1).normalize();
      return { point: hit.point.clone(), normal, fallback: false };
    }
    return null;
  }

  function fallbackDecalHit(vp) {
    const T = THREE();
    if (!T || !vp?.camera) return null;
    const direction = vp.camera.getWorldDirection(new T.Vector3()).normalize();
    let distance = 192;
    const target = vp.orbit?.target;
    if (target) {
      const targetDistance = vp.camera.position.distanceTo(target);
      if (Number.isFinite(targetDistance) && targetDistance > 0) distance = Math.max(64, Math.min(512, targetDistance * 0.35));
    }
    return {
      point: vp.camera.position.clone().addScaledVector(direction, distance),
      normal: direction.clone().multiplyScalar(-1),
      fallback: true,
    };
  }

  function makePlane(width = 128, height = 128) {
    const w = Math.max(.1, Number(width) || 128) / 2;
    const h = Math.max(.1, Number(height) || 128) / 2;
    return { vertices: [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]], faces: [[0, 1, 2, 3]] };
  }

  function rotationForNormal(normal) {
    const T = THREE();
    const quaternion = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), normal.clone().normalize());
    const euler = new T.Euler().setFromQuaternion(quaternion, 'XYZ');
    const DEG = 180 / Math.PI;
    return [euler.x * DEG, euler.y * DEG, euler.z * DEG];
  }

  function nextDecalName() {
    let highest = 0;
    for (const object of state()?.objects || []) {
      const match = String(object?.name || '').match(/^Decal[_\s-]*(\d+)$/i);
      if (match) highest = Math.max(highest, Number(match[1]) || 0);
    }
    return `Decal_${String(highest + 1).padStart(3, '0')}`;
  }

  function createDecalAlways() {
    const s = state();
    const vp = viewport();
    if (!s?.doc || !vp || !VMAP?.addPart || !THREE()) return false;

    const hit = centerSurfaceHit(vp) || fallbackDecalHit(vp);
    if (!hit) return false;

    try { pushHistory?.(); } catch {}
    const geometry = makePlane(128, 128);
    const position = hit.point.clone().addScaledVector(hit.normal, hit.fallback ? 0 : DECAL_OFFSET);
    let object = VMAP.addPart(s.doc, {
      ...geometry,
      position: position.toArray(),
      rotation: rotationForNormal(hit.normal),
      scale: [1, 1, 1],
      faceMaterials: [DEFAULT_DECAL_MATERIAL],
      material: DEFAULT_DECAL_MATERIAL,
      collision: false,
      meshName: `EPH_DECAL_${Date.now()}`,
    });
    try { object = ensureObject?.(object) || object; } catch {}
    if (!object) return false;

    object.type = 'decal';
    object.name = nextDecalName();
    object.collision = false;
    object.blockPlayers = false;
    object.blockGrenades = false;
    object.blockBullets = false;
    object.faceMaterials = [DEFAULT_DECAL_MATERIAL];
    object.materials = Object.fromEntries((VMAP.FACE_NAMES || []).map(name => [name, DEFAULT_DECAL_MATERIAL]));

    s.objects.push(object);
    s.selectedId = object.id;
    s.multiSelectedIds = [object.id];
    s.selectedFaces = new Set([0]);
    s.subSelection = null;
    vp.objects = s.objects;
    vp.updateObject?.(object);
    try { window.EPH_MULTI_SELECTION?.set?.([object.id], object.id, { selectViewport: true }); }
    catch { vp.select?.(object.id, false); }
    try { setTool?.('move'); } catch {}
    try { markDirty?.(`Created ${object.name}`); } catch {}
    try { renderTree?.(); renderProperties?.(); } catch {}
    scheduleSceneTree();
    try { toast?.(hit.fallback ? 'Decal created in front of the camera.' : 'Decal placed on the center-view surface.'); } catch {}
    return object;
  }

  function bindDecalButton(button) {
    if (!button || button.dataset.ephAlwaysDecalV50 === '1') return;
    button.dataset.ephAlwaysDecalV50 = '1';
    button.onclick = event => {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      createDecalAlways();
    };
    button.title = 'Place on the center surface, or create in front of the camera if no surface is hit';
  }

  function bindDecalButtons() {
    bindDecalButton(document.getElementById('topAddDecal'));
    bindDecalButton(document.getElementById('ephRailDecal'));
  }

  function install() {
    installTreeSync();
    installMultiMaterialApply();
    bindDecalButtons();
    scheduleSceneTree();
  }

  window.addEventListener('eph-selection-changed', scheduleSceneTree);
  window.addEventListener('eph3d-ready', () => queueMicrotask(install));
  window.addEventListener('eph-runtime-ready', () => queueMicrotask(install), { once: true });
  document.getElementById('sceneSearch')?.addEventListener('input', scheduleSceneTree, { passive: true });

  install();
  [100, 350, 900, 1800].forEach(delay => setTimeout(install, delay));

  window.EPH_INTERACTION_CONSISTENCY_V50 = {
    install,
    refreshSceneSelection: scheduleSceneTree,
    createDecal: createDecalAlways,
  };
  console.info('[Interaction Consistency V50] Scene multi-selection, multi-material application and always-available decal placement installed.');
})();
