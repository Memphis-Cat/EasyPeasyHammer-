// byanca
(() => {
  'use strict';
  if (window.__ephEditorCorrectnessV58) return;
  window.__ephEditorCorrectnessV58 = true;

  const VMAP = window.EPH_VMAP;
  const DEFAULT_DECAL_MATERIAL = 'materials/dev/dev_measuregeneric01b.vmat';
  const DECAL_OFFSET = 0.06;
  const ENTITY_SURFACE_OFFSET = 0.08;
  const ENTITY_ATTACH_DISTANCE = 8;
  const RAD_TO_DEG = 180 / Math.PI;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewport = () => window.EPH3D || state()?.viewport || null;
  const THREE = () => window.EPH_THREE || window.THREE;
  const objectById = id => state()?.objects?.find(object => object?.id === id) || null;

  function surfaceObject(object) {
    if (!object || object.visible === false || object.ephNegative || object.type === 'decal') return false;
    if (['part', 'terrain', 'prop'].includes(object.type)) return true;
    if (object.type !== 'entity') return false;
    return Boolean(
      object.ephMeshEntity
      || object.ephMeshChildIds?.length
      || object.model
      || object.entityProperties?.model
      || object.entityProperties?.modelname
      || object.entityProperties?.worldmodel
    );
  }

  function surfaceRoots(vp, excludeId = null) {
    const roots = [];
    for (const [id, root] of vp?.objectRoots || []) {
      if (id === excludeId || !root?.visible || !surfaceObject(objectById(id))) continue;
      roots.push(root);
    }
    return roots;
  }

  function worldNormal(hit, fallback = null) {
    const T = THREE();
    if (!T) return fallback;
    let normal = null;
    if (hit?.face?.normal && hit?.object) {
      normal = hit.face.normal.clone();
      try { normal.applyMatrix3(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize(); } catch {}
    }
    if (!normal || normal.lengthSq() < 1e-8) normal = fallback?.clone?.() || new T.Vector3(0, 0, 1);
    return normal.normalize();
  }

  function centerSurfaceHit(excludeId = null) {
    const vp = viewport();
    const T = THREE();
    if (!vp?.camera || !vp?.raycaster || !T) return null;
    const roots = surfaceRoots(vp, excludeId);
    if (!roots.length) return null;
    vp.raycaster.setFromCamera(new T.Vector2(0, 0), vp.camera);
    const hits = vp.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (!hit?.point || !hit?.object) continue;
      if (hit.object.userData?.ephSelectionHighlight || hit.object.userData?.ephTransformGizmo) continue;
      const fallback = vp.camera.getWorldDirection(new T.Vector3()).multiplyScalar(-1).normalize();
      return { point: hit.point.clone(), normal: worldNormal(hit, fallback), hit };
    }
    return null;
  }

  function stableRotationForNormal(normal) {
    const T = THREE();
    const n = normal.clone().normalize();

    // setFromUnitVectors aligns the decal normal but leaves its roll ambiguous.
    // Build a complete orthonormal basis so a decal never spawns with a random
    // looking twist around its surface normal.
    let y = Math.abs(n.z) > 0.92 ? new T.Vector3(0, 1, 0) : new T.Vector3(0, 0, 1);
    y.addScaledVector(n, -y.dot(n));
    if (y.lengthSq() < 1e-8) y = new T.Vector3(0, 1, 0);
    y.normalize();
    const x = new T.Vector3().crossVectors(y, n).normalize();
    const matrix = new T.Matrix4().makeBasis(x, y, n);
    const quaternion = new T.Quaternion().setFromRotationMatrix(matrix);
    const euler = new T.Euler().setFromQuaternion(quaternion, 'XYZ');
    return [euler.x * RAD_TO_DEG, euler.y * RAD_TO_DEG, euler.z * RAD_TO_DEG];
  }

  function decalFallback() {
    const vp = viewport();
    const T = THREE();
    if (!vp?.camera || !T) return null;
    const direction = vp.camera.getWorldDirection(new T.Vector3()).normalize();
    return {
      point: vp.camera.position.clone().addScaledVector(direction, 192),
      normal: direction.clone().multiplyScalar(-1),
    };
  }

  function createDecalStable() {
    const s = state();
    const vp = viewport();
    const T = THREE();
    if (!s?.doc || !vp || !T || !VMAP?.addPart) return false;
    const hit = centerSurfaceHit() || decalFallback();
    if (!hit) return false;

    try { pushHistory?.(); } catch {}
    const half = 64;
    const position = hit.point.clone().addScaledVector(hit.normal, DECAL_OFFSET);
    let object = VMAP.addPart(s.doc, {
      vertices: [[-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0]],
      faces: [[0, 1, 2, 3]],
      position: position.toArray(),
      rotation: stableRotationForNormal(hit.normal),
      scale: [1, 1, 1],
      faceMaterials: [DEFAULT_DECAL_MATERIAL],
      material: DEFAULT_DECAL_MATERIAL,
      collision: false,
      meshName: `EPH_DECAL_${Date.now()}`,
    });
    try { object = ensureObject?.(object) || object; } catch {}
    if (!object) return false;

    object.type = 'decal';
    object.name = `Decal_${String((s.objects || []).filter(item => item?.type === 'decal').length + 1).padStart(3, '0')}`;
    object.collision = false;
    object.blockPlayers = false;
    object.blockGrenades = false;
    object.blockBullets = false;
    object.faceMaterials = [DEFAULT_DECAL_MATERIAL];
    object.materials = Object.fromEntries((VMAP.FACE_NAMES || []).map(name => [name, DEFAULT_DECAL_MATERIAL]));
    VMAP.applyObjectToDocument?.(s.doc, object);

    s.objects.push(object);
    s.selectedId = object.id;
    s.multiSelectedIds = [object.id];
    s.selectedFaces = new Set([0]);
    s.subSelection = null;
    vp.objects = s.objects;
    vp.updateObject?.(object);
    vp.select?.(object.id, false);
    try { setTool?.('move'); } catch {}
    try { markDirty?.(`Created ${object.name}`); } catch {}
    try { renderTree?.(); renderProperties?.(); } catch {}
    return object;
  }

  function bindStableDecalButtons() {
    for (const id of ['topAddDecal', 'ephRailDecal']) {
      const button = document.getElementById(id);
      if (!button || button.dataset.ephStableDecalV58 === '1') continue;
      button.dataset.ephStableDecalV58 = '1';
      button.onclick = null;
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        createDecalStable();
      }, true);
    }
  }

  function traceSegment(vp, selectedId, from, to) {
    const T = THREE();
    const roots = surfaceRoots(vp, selectedId);
    if (!T || !roots.length) return null;
    const delta = to.clone().sub(from);
    const distance = delta.length();
    if (distance < 1e-6) return null;
    const direction = delta.multiplyScalar(1 / distance);
    const oldNear = vp.raycaster.near;
    const oldFar = vp.raycaster.far;
    try {
      vp.raycaster.near = 0.001;
      vp.raycaster.far = distance + ENTITY_SURFACE_OFFSET * 4;
      vp.raycaster.set(from, direction);
      const hit = vp.raycaster.intersectObjects(roots, true).find(item => item?.point && item.distance <= vp.raycaster.far);
      if (!hit) return null;
      return { point: hit.point.clone(), normal: worldNormal(hit, direction.clone().multiplyScalar(-1)), hit };
    } finally {
      vp.raycaster.near = oldNear;
      vp.raycaster.far = oldFar;
    }
  }

  function attachAlongNormal(vp, selectedId, position, normal, distance = ENTITY_ATTACH_DISTANCE) {
    const roots = surfaceRoots(vp, selectedId);
    if (!roots.length || !normal) return null;
    const direction = normal.clone().normalize().multiplyScalar(-1);
    const origin = position.clone().addScaledVector(normal, distance * 0.5);
    const oldNear = vp.raycaster.near;
    const oldFar = vp.raycaster.far;
    try {
      vp.raycaster.near = 0;
      vp.raycaster.far = distance * 1.5;
      vp.raycaster.set(origin, direction);
      const hit = vp.raycaster.intersectObjects(roots, true)[0];
      if (!hit?.point || hit.distance > vp.raycaster.far) return null;
      return { point: hit.point.clone(), normal: worldNormal(hit, normal), hit };
    } finally {
      vp.raycaster.near = oldNear;
      vp.raycaster.far = oldFar;
    }
  }

  function detectNearbySurface(vp, selectedId, position) {
    const T = THREE();
    if (!T) return null;
    const roots = surfaceRoots(vp, selectedId);
    if (!roots.length) return null;
    const directions = [
      new T.Vector3(1, 0, 0), new T.Vector3(-1, 0, 0),
      new T.Vector3(0, 1, 0), new T.Vector3(0, -1, 0),
      new T.Vector3(0, 0, 1), new T.Vector3(0, 0, -1),
    ];
    let best = null;
    const oldNear = vp.raycaster.near;
    const oldFar = vp.raycaster.far;
    try {
      vp.raycaster.near = 0;
      vp.raycaster.far = ENTITY_ATTACH_DISTANCE;
      for (const direction of directions) {
        vp.raycaster.set(position, direction);
        vp.raycaster.far = ENTITY_ATTACH_DISTANCE;
        const hit = vp.raycaster.intersectObjects(roots, true)[0];
        if (!hit?.point || !Number.isFinite(hit.distance)) continue;
        if (!best || hit.distance < best.hit.distance) best = { point: hit.point.clone(), normal: worldNormal(hit, direction.clone().multiplyScalar(-1)), hit };
      }
    } finally {
      vp.raycaster.near = oldNear;
      vp.raycaster.far = oldFar;
    }
    return best;
  }

  function installEntitySurfaceMove(vp = viewport()) {
    if (!vp?.transform || vp.__ephEntitySurfaceMoveV58) return false;
    vp.__ephEntitySurfaceMoveV58 = true;
    let session = null;
    let correcting = false;

    vp.transform.addEventListener('dragging-changed', event => {
      const object = objectById(vp.selectedId || state()?.selectedId);
      if (!event.value || vp.tool !== 'move' || vp.surfaceSnap === false || object?.type !== 'entity') {
        session = null;
        return;
      }
      const root = vp.objectRoots?.get(object.id);
      if (!root) return;
      const near = detectNearbySurface(vp, object.id, root.position.clone());
      session = { id: object.id, last: root.position.clone(), normal: near?.normal?.clone?.() || null };
    });

    vp.transform.addEventListener('objectChange', () => {
      if (correcting || !session || vp.tool !== 'move' || vp.surfaceSnap === false) return;
      const object = objectById(session.id);
      const root = vp.objectRoots?.get(session.id);
      if (!object || object.type !== 'entity' || !root) { session = null; return; }

      const candidate = root.position.clone();
      let contact = traceSegment(vp, session.id, session.last, candidate);
      if (!contact && session.normal) contact = attachAlongNormal(vp, session.id, candidate, session.normal);
      if (contact) {
        root.position.copy(contact.point).addScaledVector(contact.normal, ENTITY_SURFACE_OFFSET);
        session.normal = contact.normal.clone();
        correcting = true;
        try {
          vp.syncSelectedFromRoot?.(false);
          vp.updateSelectionBox?.();
          VMAP?.applyObjectToDocument?.(state()?.doc, object);
        } finally { correcting = false; }
      }
      session.last.copy(root.position);
    });
    return true;
  }

  function ensureToolUiStyle() {
    if (document.getElementById('ephToolUiV58Style')) return;
    const style = document.createElement('style');
    style.id = 'ephToolUiV58Style';
    style.textContent = `
      #editorScreen .eph-v58-tool-context{display:none!important;visibility:hidden!important;}
      #editorScreen[data-eph-active-tool="move"] .eph-v58-tool-context[data-eph-tool-context="move"],
      #editorScreen[data-eph-active-tool="rotate"] .eph-v58-tool-context[data-eph-tool-context="rotate"],
      #editorScreen[data-eph-active-tool="scale"] .eph-v58-tool-context[data-eph-tool-context="scale"]{
        display:inline-flex!important;visibility:visible!important;
      }
    `;
    document.head.appendChild(style);
  }

  function contextHost(element) {
    if (!element) return null;
    if (element.matches?.('.move-options,.rotate-options,.scale-options,.eph-transform-option,#ephScaleV21')) return element;
    return element.closest?.('.move-options,.rotate-options,.scale-options,.eph-transform-option,#ephScaleV21') || element;
  }

  function markToolContexts() {
    const assignments = [
      ['move', '.move-options,#ephMoveSnap,#ephSurfaceSnap,[data-move-option],[data-eph-move-option]'],
      ['rotate', '.rotate-options,#rotateSnapSelect,#outerRingButton,[data-rotate-option],[data-eph-rotate-option]'],
      ['scale', '.scale-options,#ephScaleV21,[data-scale-option],[data-eph-scale-option]'],
    ];
    const seen = new Set();
    for (const [tool, selector] of assignments) {
      for (const element of document.querySelectorAll(selector)) {
        const host = contextHost(element);
        if (!host || host.closest?.('#toolRail')) continue;
        host.dataset.ephToolContext = tool;
        host.classList.add('eph-v58-tool-context');
        seen.add(host);
      }
    }
    for (const element of document.querySelectorAll('[data-eph-tool-context]')) {
      if (element.closest?.('#toolRail')) continue;
      const tool = String(element.dataset.ephToolContext || '').toLowerCase();
      if (!['move', 'rotate', 'scale'].includes(tool)) continue;
      const host = contextHost(element);
      if (!host) continue;
      host.dataset.ephToolContext = tool;
      host.classList.add('eph-v58-tool-context');
      seen.add(host);
    }
    return seen;
  }

  function syncToolUi(tool = null) {
    ensureToolUiStyle();
    markToolContexts();
    const s = state();
    const editor = document.getElementById('editorScreen');
    const active = String(tool || s?.tool || viewport()?.tool || 'select').toLowerCase();
    if (editor) editor.dataset.ephActiveTool = active;
    document.querySelectorAll('.tool-mode[data-tool],#toolRail [data-tool]').forEach(button => {
      const name = String(button.dataset.tool || '').toLowerCase();
      if (['move', 'rotate', 'scale', 'vertex', 'edge', 'face', 'extrude', 'clip', 'texture', 'light', 'entity', 'terrain', 'select'].includes(name)) {
        button.classList.toggle('active', name === active);
      }
    });
  }

  function installToolUi() {
    ensureToolUiStyle();
    syncToolUi();

    try {
      if (typeof setTool === 'function' && !setTool.__ephImmediateToolUiV58) {
        const previous = setTool;
        const wrapped = function(tool, ...rest) {
          syncToolUi(tool);
          const result = previous.call(this, tool, ...rest);
          syncToolUi(state()?.tool || tool);
          return result;
        };
        for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
        wrapped.__ephImmediateToolUiV58 = true;
        wrapped.__ephPrevious = previous;
        setTool = wrapped;
        window.setTool = wrapped;
      }
    } catch {}

    try {
      if (typeof renderTools === 'function' && !renderTools.__ephImmediateToolUiV58) {
        const previous = renderTools;
        const wrapped = function(...args) {
          const result = previous.apply(this, args);
          syncToolUi();
          return result;
        };
        wrapped.__ephImmediateToolUiV58 = true;
        wrapped.__ephPrevious = previous;
        renderTools = wrapped;
        window.renderTools = wrapped;
      }
    } catch {}

    if (document.documentElement.dataset.ephToolUiCaptureV58 !== '1') {
      document.documentElement.dataset.ephToolUiCaptureV58 = '1';
      document.addEventListener('pointerdown', event => {
        const button = event.target?.closest?.('.tool-mode[data-tool],#toolRail [data-tool]');
        if (button?.dataset?.tool) syncToolUi(button.dataset.tool);
      }, true);
      document.addEventListener('click', event => {
        const button = event.target?.closest?.('.tool-mode[data-tool],#toolRail [data-tool]');
        if (button?.dataset?.tool) syncToolUi(button.dataset.tool);
      }, true);
    }

    const toolbar = document.querySelector('.toolbar-row');
    if (toolbar && toolbar.dataset.ephToolUiObserverV58 !== '1') {
      toolbar.dataset.ephToolUiObserverV58 = '1';
      new MutationObserver(() => syncToolUi()).observe(toolbar, { childList: true, subtree: true });
    }
  }

  function install() {
    bindStableDecalButtons();
    installEntitySurfaceMove();
    installToolUi();
  }

  install();
  window.addEventListener('eph3d-ready', () => queueMicrotask(install));
  window.addEventListener('eph-runtime-ready', () => queueMicrotask(install), { once: true });
  [0, 80, 250, 700].forEach(delay => setTimeout(install, delay));

  window.EPH_EDITOR_CORRECTNESS_V58 = {
    install,
    createDecal: createDecalStable,
    syncToolUi,
  };

  console.info('[Editor Correctness V58] Stable decal orientation, entity surface movement and immediate tool settings UI installed.');
})();
