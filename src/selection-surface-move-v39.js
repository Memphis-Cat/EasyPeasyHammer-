// byanca
(() => {
  'use strict';
  if (window.__ephSelectionSurfaceMoveV39) return;
  window.__ephSelectionSurfaceMoveV39 = true;

  const api = window.easyPeasyHammer;
  const CONTACT_EPSILON = 0.08;
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

  function bindKnownSurfaceToggle(viewport) {
    if (!viewport) return;
    if (!viewport.__ephSurfaceDefaultAppliedV39) {
      viewport.__ephSurfaceDefaultAppliedV39 = true;
      viewport.surfaceSnap = true;
      localStorage.setItem('eph-surface-snap', '1');
      surfaceEnabled = true;
    } else {
      surfaceEnabled = viewport.surfaceSnap !== false;
    }

    const button = document.getElementById('ephSurfaceSnap');
    if (!button) return;
    button.classList.toggle('active', surfaceEnabled);
    button.title = 'Keep moved objects on surfaces and stop them at floors, walls and ceilings';
    if (button.dataset.ephSurfaceMoveV39 === '1') return;
    button.dataset.ephSurfaceMoveV39 = '1';
    button.addEventListener('click', () => {
      queueMicrotask(() => {
        surfaceEnabled = viewport.surfaceSnap !== false;
        localStorage.setItem('eph-surface-snap', surfaceEnabled ? '1' : '0');
        button.classList.toggle('active', surfaceEnabled);
      });
    });
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
    select.value = option.value;
    surfaceEnabled = true;
    try { select.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    select.addEventListener('change', () => {
      const selected = select.options?.[select.selectedIndex];
      surfaceEnabled = /surface/i.test(`${select.value} ${selected?.textContent || ''}`);
    });
  }

  function installSurfaceDefault(viewport = window.EPH3D || state()?.viewport) {
    bindKnownSurfaceToggle(viewport);
    document.querySelectorAll('select').forEach(bindSurfaceControl);
    if (surfaceObserver) return;
    surfaceObserver = new MutationObserver(records => {
      bindKnownSurfaceToggle(window.EPH3D || state()?.viewport);
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

    // Point helpers and particle helpers can be much thinner than a Part. Give
    // every rendered object root a small screen-space target as a fallback.
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

    // Window capture runs before the legacy canvas handlers, so a successful
    // click cannot subsequently be cleared by the older box-selection code.
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
    if (object.type === 'part' || object.type === 'terrain' || object.type === 'prop') return true;
    if (object.type === 'entity' && (object.ephMeshEntity || object.ephMeshChildIds?.length)) return true;
    return false;
  }

  function collisionRoots(viewport, selectedId) {
    const roots = [];
    for (const [id, root] of viewport.objectRoots || []) {
      if (id === selectedId || !root?.visible) continue;
      if (!obstacleEligible(selectedObject(id))) continue;
      roots.push(root);
    }
    return roots;
  }

  function leadingFaceSamples(box, direction) {
    const T = THREE();
    if (!T || !box || box.isEmpty()) return [];
    const min = box.min, max = box.max;
    const mid = min.clone().add(max).multiplyScalar(0.5);
    const samples = [];
    const addFace = (axis, positive) => {
      const fixed = positive ? max.getComponent(axis) : min.getComponent(axis);
      const a = (axis + 1) % 3;
      const b = (axis + 2) % 3;
      const valuesA = [min.getComponent(a), mid.getComponent(a), max.getComponent(a)];
      const valuesB = [min.getComponent(b), mid.getComponent(b), max.getComponent(b)];
      for (const va of valuesA) for (const vb of valuesB) {
        const point = mid.clone();
        point.setComponent(axis, fixed);
        point.setComponent(a, va);
        point.setComponent(b, vb);
        samples.push(point);
      }
    };

    const absolute = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
    const largest = Math.max(...absolute);
    for (let axis = 0; axis < 3; axis++) {
      // Always sample the dominant leading face, and sample secondary faces for
      // diagonal movement so corners cannot tunnel through perpendicular walls.
      if (absolute[axis] < Math.max(0.12, largest * 0.35)) continue;
      addFace(axis, direction.getComponent(axis) >= 0);
    }
    if (!samples.length) addFace(2, direction.z >= 0);

    const unique = new Map();
    for (const point of samples) {
      const key = `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`;
      unique.set(key, point);
    }
    return [...unique.values()];
  }

  function clampedMovePosition(viewport, selectedId, from, to) {
    const T = THREE();
    const root = viewport.objectRoots?.get(selectedId);
    if (!T || !root) return to;
    const delta = to.clone().sub(from);
    const distance = delta.length();
    if (distance < 1e-7) return to;
    const direction = delta.clone().multiplyScalar(1 / distance);
    const candidates = collisionRoots(viewport, selectedId);
    if (!candidates.length) return to;

    // root is currently at `to`; translate its exact world bounds back to the
    // last accepted position and cast from the leading faces through the real
    // rendered triangles. This works for hollow/CSG rooms where a whole-object
    // AABB would incorrectly treat the empty room as solid.
    const previousBox = new T.Box3().setFromObject(root).translate(from.clone().sub(to));
    if (previousBox.isEmpty()) return to;
    const samples = leadingFaceSamples(previousBox, direction);
    if (!samples.length) return to;

    const oldNear = viewport.raycaster.near;
    const oldFar = viewport.raycaster.far;
    let nearest = Infinity;
    try {
      viewport.raycaster.near = 0;
      viewport.raycaster.far = distance + CONTACT_EPSILON * 4;
      for (const sample of samples) {
        // Start a hair behind the leading face to keep exact contact stable.
        const origin = sample.clone().addScaledVector(direction, -CONTACT_EPSILON * 0.25);
        viewport.raycaster.set(origin, direction);
        viewport.raycaster.far = distance + CONTACT_EPSILON * 4;
        const hit = viewport.raycaster.intersectObjects(candidates, true)[0];
        if (!hit || !Number.isFinite(hit.distance)) continue;
        nearest = Math.min(nearest, hit.distance);
      }
    } finally {
      viewport.raycaster.near = oldNear;
      viewport.raycaster.far = oldFar;
    }

    if (!Number.isFinite(nearest) || nearest > distance + CONTACT_EPSILON) return to;
    const safeDistance = Math.max(0, nearest - CONTACT_EPSILON);
    return from.clone().addScaledVector(direction, Math.min(distance, safeDistance));
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
        // Re-run the authoritative transform chain with the corrected position.
        raw(doCommit, ...rest);
        this.updateSelectionBox?.();
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
    installSurfaceDefault(viewport);
    if (!viewport?.renderer?.domElement || !viewport?.objectRoots) return false;
    installedViewport = viewport;
    installClickSelection(viewport);
    installSurfaceStopping(viewport);
    if (!viewport.__ephSelectionSurfaceAnnouncedV39) {
      viewport.__ephSelectionSurfaceAnnouncedV39 = true;
      report('normal', 'Surface is the default Move mode. Real-geometry wall/floor/ceiling stopping and universal Select clicks are enabled.');
    }
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
    installSurfaceDefault(viewport);
    if (checks >= 48) clearInterval(guard);
  }, 250);

  window.EPH_SURFACE_MOVE_V39 = {
    enabled: () => surfaceEnabled,
    setEnabled: value => {
      surfaceEnabled = Boolean(value);
      const viewport = window.EPH3D || state()?.viewport;
      if (viewport) viewport.surfaceSnap = surfaceEnabled;
      localStorage.setItem('eph-surface-snap', surfaceEnabled ? '1' : '0');
      document.getElementById('ephSurfaceSnap')?.classList.toggle('active', surfaceEnabled);
    },
    selectAt: event => hitSelectable(window.EPH3D || state()?.viewport, event),
  };
})();
