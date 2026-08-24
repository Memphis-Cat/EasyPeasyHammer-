// byanca
(() => {
  'use strict';
  if (window.__ephSelectionSurfaceMoveV39) return;
  window.__ephSelectionSurfaceMoveV39 = true;

  const api = window.easyPeasyHammer;
  const CONTACT_EPSILON = 0.06;
  const CLICK_DISTANCE = 5;
  let installedViewport = null;
  let moveSession = null;
  let clickStart = null;
  let surfaceEnabled = true;
  let surfaceObserver = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Selection / Surface Move V39] ${message}`, meta || '');
    try { api?.appLog?.(level, 'selection-surface-move-v39', message, meta)?.catch?.(() => {}); } catch {}
  }

  function selectedObject(id = null) {
    const s = state();
    const wanted = id || s?.selectedId;
    return s?.objects?.find(object => object?.id === wanted) || null;
  }

  function selectableId(id) {
    const object = selectedObject(id);
    if (!object || ['world', 'folder'].includes(object.type) || object.visible === false) return null;
    if (object.ephMeshEntityChild && object.parent && selectedObject(object.parent)) return object.parent;
    return object.id;
  }

  function surfaceControlCandidate(select) {
    if (!select?.options?.length) return null;
    const options = [...select.options];
    const surface = options.find(option => /surface/i.test(`${option.value} ${option.textContent || ''}`));
    if (!surface) return null;
    const context = `${select.id || ''} ${select.className || ''} ${select.closest?.('.toolbar-row,.mode-group,.eph-transform-option,.move-options')?.textContent || ''}`;
    return /move|surface/i.test(context) ? surface : null;
  }

  function bindSurfaceControl(select) {
    if (!select || select.dataset.ephSurfaceMoveV39 === '1') return;
    const option = surfaceControlCandidate(select);
    if (!option) return;
    select.dataset.ephSurfaceMoveV39 = '1';

    // Surface is the default for every fresh editor runtime. After that the user
    // can still deliberately choose another mode for the current session.
    select.value = option.value;
    surfaceEnabled = true;
    try { select.dispatchEvent(new Event('change', { bubbles: true })); } catch {}

    select.addEventListener('change', () => {
      const selected = select.options?.[select.selectedIndex];
      surfaceEnabled = /surface/i.test(`${select.value} ${selected?.textContent || ''}`);
    });
  }

  function installSurfaceDefault() {
    document.querySelectorAll('select').forEach(bindSurfaceControl);
    if (surfaceObserver) return;
    surfaceObserver = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.('select')) bindSurfaceControl(node);
          node.querySelectorAll?.('select').forEach(bindSurfaceControl);
        }
      }
    });
    surfaceObserver.observe(document.body, { childList: true, subtree: true });
  }

  function rootIdForHit(viewport, hitObject) {
    if (!hitObject) return null;
    const rootIds = new Map();
    for (const [id, root] of viewport.objectRoots || []) rootIds.set(root, id);
    let node = hitObject;
    while (node) {
      if (rootIds.has(node)) return selectableId(rootIds.get(node));
      if (node === viewport.objectGroup) break;
      node = node.parent;
    }
    return null;
  }

  function rayFromEvent(viewport, event) {
    const canvas = viewport.renderer?.domElement;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    viewport.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    viewport.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
    return rect;
  }

  function hitSelectable(viewport, event) {
    const rect = rayFromEvent(viewport, event);
    if (!rect) return null;
    const roots = [...(viewport.objectRoots?.values?.() || [])];
    const hits = viewport.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      const id = rootIdForHit(viewport, hit.object);
      if (id) return id;
    }

    // Some Hammer point helpers are sprites/lines with a very small or custom
    // raycast target. Give point entities and particles a screen-space click
    // radius so they are still selectable like Hammer helpers.
    const T = THREE();
    if (!T) return null;
    let best = null;
    for (const [id, root] of viewport.objectRoots || []) {
      const resolved = selectableId(id);
      if (!resolved) continue;
      const point = root.getWorldPosition(new T.Vector3()).project(viewport.camera);
      if (!Number.isFinite(point.x) || point.z < -1 || point.z > 1) continue;
      const x = rect.left + (point.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-point.y * 0.5 + 0.5) * rect.height;
      const distance = Math.hypot(event.clientX - x, event.clientY - y);
      if (distance > 16) continue;
      if (!best || distance < best.distance || (distance === best.distance && point.z < best.depth)) {
        best = { id: resolved, distance, depth: point.z };
      }
    }
    return best?.id || null;
  }

  function eventTargetsCanvas(viewport, event) {
    const canvas = viewport?.renderer?.domElement;
    if (!canvas) return false;
    return event.target === canvas || event.composedPath?.().includes(canvas);
  }

  function installClickSelection(viewport) {
    if (viewport.__ephClickSelectionV39) return;
    viewport.__ephClickSelectionV39 = true;

    window.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !eventTargetsCanvas(viewport, event)) return;
      if ((viewport.tool || state()?.tool) !== 'select') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      clickStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    }, true);

    window.addEventListener('pointerup', event => {
      const start = clickStart;
      clickStart = null;
      if (!start || start.pointerId !== event.pointerId || event.button !== 0) return;
      if (!eventTargetsCanvas(viewport, event)) return;
      if ((viewport.tool || state()?.tool) !== 'select') return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_DISTANCE) return;
      const id = hitSelectable(viewport, event);
      if (!id) return;

      // Run before the legacy canvas pointer-up handler. This prevents an older
      // handler from clearing the selection after we correctly hit a prop,
      // entity, particle helper, or mesh wrapper.
      event.preventDefault();
      event.stopImmediatePropagation();
      viewport.select?.(id, true);
      const s = state();
      if (s) {
        s.selectedId = id;
        s.selectedFaces = new Set([0]);
        s.subSelection = null;
      }
      try { renderTree?.(); renderProperties?.(); } catch {}
    }, true);
  }

  function obstacleEligible(object) {
    if (!object || object.visible === false || object.ephNegative || object.ephWeatherVolume || object.ephMeshEntityChild) return false;
    if (object.type === 'part' || object.type === 'prop') return true;
    if (['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length)) return true;
    return false;
  }

  function shrinkBox(box, epsilon = CONTACT_EPSILON) {
    const T = THREE();
    if (!box || !T || box.isEmpty()) return box;
    const size = box.getSize(new T.Vector3());
    for (let axis = 0; axis < 3; axis++) {
      if (size.getComponent(axis) <= epsilon * 2.5) continue;
      box.min.setComponent(axis, box.min.getComponent(axis) + epsilon);
      box.max.setComponent(axis, box.max.getComponent(axis) - epsilon);
    }
    return box;
  }

  function obstacleBoxes(viewport, selectedId) {
    const T = THREE();
    if (!T) return [];
    const boxes = [];
    for (const [id, root] of viewport.objectRoots || []) {
      if (id === selectedId || !root?.visible) continue;
      const object = selectedObject(id);
      if (!obstacleEligible(object)) continue;
      const box = new T.Box3().setFromObject(root);
      if (box.isEmpty()) continue;
      boxes.push({ id, box: shrinkBox(box, CONTACT_EPSILON * 0.5) });
    }
    return boxes;
  }

  function translatedBox(source, offset) {
    return source.clone().translate(offset);
  }

  function intersectsAny(box, obstacles) {
    return obstacles.some(item => box.intersectsBox(item.box));
  }

  function clampedMovePosition(viewport, selectedId, from, to) {
    const T = THREE();
    const root = viewport.objectRoots?.get(selectedId);
    if (!T || !root) return to;
    const distance = from.distanceTo(to);
    if (distance < 1e-7) return to;

    const candidateBox = shrinkBox(new T.Box3().setFromObject(root));
    if (candidateBox.isEmpty()) return to;
    const obstacles = obstacleBoxes(viewport, selectedId);
    if (!obstacles.length) return to;

    const fromOffset = from.clone().sub(to);
    const startBox = translatedBox(candidateBox, fromOffset);
    // If an imported/old object already overlaps geometry, do not trap it. Let
    // the user drag it out; collision stopping resumes on the next safe frame.
    if (intersectsAny(startBox, obstacles)) return to;
    if (!intersectsAny(candidateBox, obstacles)) return to;

    const extents = candidateBox.getSize(new T.Vector3());
    const smallest = Math.max(1, Math.min(extents.x || 1, extents.y || 1, extents.z || 1));
    const steps = Math.max(4, Math.min(64, Math.ceil(distance / Math.max(1, smallest * 0.2))));
    const direction = to.clone().sub(from);
    let safeT = 0;
    let hitT = 1;

    for (let index = 1; index <= steps; index++) {
      const t = index / steps;
      const sample = from.clone().addScaledVector(direction, t);
      const offset = sample.clone().sub(to);
      if (intersectsAny(translatedBox(candidateBox, offset), obstacles)) {
        hitT = t;
        break;
      }
      safeT = t;
    }

    // Resolve the contact to sub-unit precision. The result is the closest safe
    // transform before the floor, wall, ceiling, or other solid surface.
    for (let iteration = 0; iteration < 12; iteration++) {
      const mid = (safeT + hitT) * 0.5;
      const sample = from.clone().addScaledVector(direction, mid);
      const offset = sample.clone().sub(to);
      if (intersectsAny(translatedBox(candidateBox, offset), obstacles)) hitT = mid;
      else safeT = mid;
    }
    return from.clone().addScaledVector(direction, safeT);
  }

  function beginMove(viewport) {
    if (viewport.tool !== 'move') return;
    const id = viewport.selectedId || state()?.selectedId;
    const root = viewport.objectRoots?.get(id);
    if (!id || !root) return;
    moveSession = { id, lastSafe: root.position.clone() };
  }

  function installSurfaceStopping(viewport) {
    if (viewport.syncSelectedFromRoot?.__ephSurfaceMoveV39) return;
    if (typeof viewport.syncSelectedFromRoot !== 'function') return;
    const previous = viewport.syncSelectedFromRoot;
    const raw = previous.bind(viewport);
    const wrapped = function(doCommit, ...rest) {
      if (this.tool !== 'move' || !surfaceEnabled) return raw(doCommit, ...rest);
      if (!moveSession || moveSession.id !== this.selectedId) beginMove(this);
      const session = moveSession;
      const result = raw(doCommit, ...rest);
      if (!session || session.id !== this.selectedId) return result;
      const root = this.objectRoots?.get(session.id);
      if (!root) return result;

      const candidate = root.position.clone();
      const safe = clampedMovePosition(this, session.id, session.lastSafe, candidate);
      if (safe.distanceToSquared(candidate) > 1e-10) {
        root.position.copy(safe);
        // Re-run the existing authoritative transform chain once with the
        // corrected position so mesh entities, point entities and persistence
        // wrappers all receive the same wall-stopped transform.
        raw(doCommit, ...rest);
      }
      session.lastSafe.copy(root.position);
      if (doCommit) moveSession = null;
      return result;
    };
    for (const key of Object.keys(previous || {})) if (key.startsWith('__eph')) wrapped[key] = previous[key];
    wrapped.__ephSurfaceMoveV39 = true;
    wrapped.__ephPrevious = previous;
    viewport.syncSelectedFromRoot = wrapped;

    if (!viewport.__ephSurfaceMoveEventsV39) {
      viewport.__ephSurfaceMoveEventsV39 = true;
      viewport.transform?.addEventListener('dragging-changed', event => {
        if (viewport.tool !== 'move') return;
        if (event.value) beginMove(viewport);
        else moveSession = null;
      });
    }
  }

  function install(viewport = window.EPH3D || state()?.viewport) {
    installSurfaceDefault();
    if (!viewport?.renderer?.domElement || !viewport?.objectRoots) return false;
    installedViewport = viewport;
    installClickSelection(viewport);
    installSurfaceStopping(viewport);
    report('normal', 'Surface is the default Move mode. Wall/floor/ceiling stopping and universal Select clicks are enabled.');
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const viewport = window.EPH3D || state()?.viewport;
    if (viewport && (!installedViewport || installedViewport !== viewport || !viewport.syncSelectedFromRoot?.__ephSurfaceMoveV39)) install(viewport);
    installSurfaceDefault();
    if (checks >= 48) clearInterval(guard);
  }, 250);

  window.EPH_SURFACE_MOVE_V39 = {
    enabled: () => surfaceEnabled,
    setEnabled: value => { surfaceEnabled = Boolean(value); },
    selectAt: event => hitSelectable(window.EPH3D || state()?.viewport, event),
  };
})();
