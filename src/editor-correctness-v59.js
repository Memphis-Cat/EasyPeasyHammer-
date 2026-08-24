// byanca
(() => {
  'use strict';
  if (window.__ephEditorCorrectnessV59) return;
  window.__ephEditorCorrectnessV59 = true;

  const VMAP = window.EPH_VMAP;
  const T = () => window.EPH_THREE || window.THREE;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const vpNow = () => window.EPH3D || state()?.viewport || null;
  const objectById = id => state()?.objects?.find(object => object?.id === id) || null;
  const CONTACT_EPSILON = 0.08;

  function isSurface(object) {
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

  function removeMirroredAxisHandles(vp = vpNow()) {
    const THREE = T();
    if (!vp?.scene || !THREE) return false;
    const names = ['EPH_CompleteNegativeTransformHandlesV44', 'EPH_HammerNegativeAxisRails'];
    for (const name of names) {
      const matches = [];
      vp.scene.traverse?.(node => {
        if (node?.name === name && !node.userData?.ephV59Blocker) matches.push(node);
      });
      for (const node of matches) node.parent?.remove?.(node);

      let blocker = vp.scene.children?.find?.(node => node?.name === name && node.userData?.ephV59Blocker);
      if (!blocker) {
        blocker = new THREE.Group();
        blocker.name = name;
        blocker.visible = false;
        blocker.userData.ephV59Blocker = true;
        blocker.userData.ephTransformGizmo = true;
        vp.scene.add(blocker);
      }
    }
    return true;
  }

  function knownToolHosts() {
    const result = [];
    const moveSnap = document.getElementById('ephMoveSnap');
    if (moveSnap?.parentElement) result.push([moveSnap.parentElement, 'move']);
    const rotate = document.querySelector('.rotate-options');
    if (rotate) result.push([rotate, 'rotate']);
    const scale = document.getElementById('ephScaleV21');
    if (scale) result.push([scale, 'scale']);
    return result;
  }

  function syncToolUi(requested = null) {
    const s = state();
    const vp = vpNow();
    const active = String(requested || s?.tool || vp?.tool || 'select').toLowerCase();
    const editor = document.getElementById('editorScreen');
    if (editor) editor.dataset.ephV59Tool = active;

    for (const [host, owner] of knownToolHosts()) {
      host.dataset.ephV59ToolOwner = owner;
      host.style.setProperty('display', owner === active ? 'inline-flex' : 'none', 'important');
      host.style.setProperty('visibility', owner === active ? 'visible' : 'hidden', 'important');
      host.style.setProperty('pointer-events', owner === active ? 'auto' : 'none', 'important');
    }

    document.querySelectorAll('.tool-mode[data-tool], #toolRail [data-tool]').forEach(button => {
      button.classList.toggle('active', String(button.dataset.tool || '').toLowerCase() === active);
    });
    return active;
  }

  function applyToolImmediately(tool) {
    const name = String(tool || '').toLowerCase();
    if (!['select', 'move', 'rotate', 'scale'].includes(name)) return false;
    syncToolUi(name);
    try {
      if (typeof setTool === 'function') setTool(name);
      else {
        const s = state();
        if (s) s.tool = name;
        vpNow()?.setTool?.(name);
        try { renderTools?.(); } catch {}
      }
    } catch {
      const s = state();
      if (s) s.tool = name;
      vpNow()?.setTool?.(name);
    }
    syncToolUi(name);
    return true;
  }

  function installToolUi() {
    syncToolUi();

    if (document.documentElement.dataset.ephV59ToolCapture !== '1') {
      document.documentElement.dataset.ephV59ToolCapture = '1';
      document.addEventListener('pointerdown', event => {
        const button = event.target?.closest?.('.toolbar-row .tool-mode[data-tool]');
        const tool = String(button?.dataset?.tool || '').toLowerCase();
        if (['select', 'move', 'rotate', 'scale'].includes(tool)) syncToolUi(tool);
      }, true);
      document.addEventListener('click', event => {
        const button = event.target?.closest?.('.toolbar-row .tool-mode[data-tool]');
        const tool = String(button?.dataset?.tool || '').toLowerCase();
        if (!['select', 'move', 'rotate', 'scale'].includes(tool)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        applyToolImmediately(tool);
      }, true);
    }

    if (typeof setTool === 'function' && !setTool.__ephV59ToolUi) {
      const previous = setTool;
      const wrapped = function(tool, ...rest) {
        syncToolUi(tool);
        const result = previous.call(this, tool, ...rest);
        syncToolUi(state()?.tool || tool);
        return result;
      };
      for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
      wrapped.__ephV59ToolUi = true;
      wrapped.__ephPrevious = previous;
      try { setTool = wrapped; } catch {}
      window.setTool = wrapped;
    }

    const group = document.querySelector('.toolbar-row .mode-group');
    if (group && group.dataset.ephV59ToolObserver !== '1') {
      group.dataset.ephV59ToolObserver = '1';
      new MutationObserver(() => syncToolUi()).observe(group, { childList: true, subtree: true });
    }
  }

  function meshWrapper(vp) {
    return window.EPH_MESH_ENTITY_TRANSFORM_V31?.selectedWrapper?.()
      || (() => {
        const object = objectById(vp?.selectedId || state()?.selectedId);
        return object?.type === 'entity' && (object.ephMeshEntity || object.ephMeshChildIds?.length) ? object : null;
      })();
  }

  function meshChildren(wrapper) {
    const fromApi = window.EPH_MESH_ENTITY_TRANSFORM_V31?.childParts?.(wrapper);
    if (Array.isArray(fromApi) && fromApi.length) return fromApi;
    const ids = new Set(wrapper?.ephMeshChildIds || []);
    for (const object of state()?.objects || []) if (object?.type === 'part' && object.parent === wrapper?.id) ids.add(object.id);
    return [...ids].map(objectById).filter(Boolean);
  }

  function candidateRoots(vp, excludeIds) {
    const roots = [];
    for (const [id, root] of vp?.objectRoots || []) {
      if (excludeIds.has(id) || !root?.visible || !isSurface(objectById(id))) continue;
      roots.push(root);
    }
    return roots;
  }

  function leadingFaceSamples(box, direction) {
    const THREE = T();
    if (!THREE || !box || box.isEmpty()) return [];
    const min = box.min, max = box.max;
    const mid = min.clone().add(max).multiplyScalar(0.5);
    const absolute = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
    const largest = Math.max(...absolute);
    const out = [];

    const addFace = axis => {
      const positive = direction.getComponent(axis) >= 0;
      const fixed = positive ? max.getComponent(axis) : min.getComponent(axis);
      const a = (axis + 1) % 3;
      const b = (axis + 2) % 3;
      const av = [min.getComponent(a), mid.getComponent(a), max.getComponent(a)];
      const bv = [min.getComponent(b), mid.getComponent(b), max.getComponent(b)];
      for (const va of av) for (const vb of bv) {
        const point = mid.clone();
        point.setComponent(axis, fixed);
        point.setComponent(a, va);
        point.setComponent(b, vb);
        out.push(point);
      }
    };

    for (let axis = 0; axis < 3; axis++) {
      if (absolute[axis] >= Math.max(0.08, largest * 0.28)) addFace(axis);
    }
    if (!out.length) addFace(2);
    return out;
  }

  function sweptClamp(vp, session, candidatePosition) {
    const THREE = T();
    if (!THREE) return null;
    const delta = candidatePosition.clone().sub(session.lastPosition);
    const distance = delta.length();
    if (distance < 1e-6) return null;
    const direction = delta.clone().multiplyScalar(1 / distance);
    const roots = candidateRoots(vp, session.excludeIds);
    if (!roots.length) return null;
    const samples = leadingFaceSamples(session.lastBox, direction);
    if (!samples.length) return null;

    const oldNear = vp.raycaster.near;
    const oldFar = vp.raycaster.far;
    let nearest = null;
    try {
      vp.raycaster.near = 0;
      vp.raycaster.far = distance + CONTACT_EPSILON * 4;
      for (const sample of samples) {
        const origin = sample.clone().addScaledVector(direction, -CONTACT_EPSILON * 0.25);
        vp.raycaster.set(origin, direction);
        vp.raycaster.far = distance + CONTACT_EPSILON * 4;
        const hit = vp.raycaster.intersectObjects(roots, true)[0];
        if (!hit?.point || !Number.isFinite(hit.distance)) continue;
        if (!nearest || hit.distance < nearest.distance) nearest = hit;
      }
    } finally {
      vp.raycaster.near = oldNear;
      vp.raycaster.far = oldFar;
    }
    if (!nearest || nearest.distance > distance + CONTACT_EPSILON) return null;
    const safeDistance = Math.max(0, nearest.distance - CONTACT_EPSILON);
    return session.lastPosition.clone().addScaledVector(direction, Math.min(distance, safeDistance));
  }

  function installMeshEntitySurfaceMove(vp = vpNow()) {
    if (!vp?.transform || !vp?.objectRoots || vp.__ephMeshEntitySurfaceMoveV59) return false;
    vp.__ephMeshEntitySurfaceMoveV59 = true;
    const THREE = T();
    let session = null;
    let correcting = false;

    vp.transform.addEventListener('dragging-changed', event => {
      if (!event.value || vp.tool !== 'move' || vp.surfaceSnap === false) {
        session = null;
        return;
      }
      const wrapper = meshWrapper(vp);
      if (!wrapper) return;
      const children = meshChildren(wrapper);
      const root = vp.transform.object || children.map(child => vp.objectRoots.get(child.id)).find(Boolean);
      if (!root) return;
      root.updateMatrixWorld?.(true);
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      session = {
        wrapperId: wrapper.id,
        root,
        lastPosition: root.position.clone(),
        lastBox: box.clone(),
        excludeIds: new Set([wrapper.id, ...children.map(child => child.id)]),
      };
    });

    vp.transform.addEventListener('objectChange', () => {
      if (correcting || !session || vp.tool !== 'move' || vp.surfaceSnap === false) return;
      const wrapper = objectById(session.wrapperId);
      const root = session.root;
      if (!wrapper || !root || vp.transform.object !== root) { session = null; return; }

      const candidate = root.position.clone();
      const corrected = sweptClamp(vp, session, candidate);
      if (corrected && corrected.distanceToSquared(candidate) > 1e-10) {
        root.position.copy(corrected);
        correcting = true;
        try {
          vp.syncSelectedFromRoot?.(false);
          vp.updateSelectionBox?.();
          VMAP?.applyObjectToDocument?.(state()?.doc, wrapper);
        } finally {
          correcting = false;
        }
      }
      root.updateMatrixWorld?.(true);
      session.lastPosition.copy(root.position);
      session.lastBox.setFromObject(root);
    });
    return true;
  }

  function install(vp = vpNow()) {
    removeMirroredAxisHandles(vp);
    installToolUi();
    installMeshEntitySurfaceMove(vp);
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    install();
    syncToolUi();
    if (checks >= 100) clearInterval(guard);
  }, 100);

  window.EPH_EDITOR_CORRECTNESS_V59 = {
    install,
    syncToolUi,
    removeMirroredAxisHandles,
  };

  console.info('[Editor Correctness V59] Mesh entities now stop on model surfaces, transform settings are synchronous, and duplicate mirrored axis arrows are disabled.');
})();
