// byanca
(() => {
  'use strict';
  if (window.__ephMeshEntityTransformV31) return;
  window.__ephMeshEntityTransformV31 = true;

  let installedViewport = null;
  let scalePrime = null;
  let wrappedTransformStart = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const objects = () => state()?.objects || [];
  const objectById = id => objects().find(object => object?.id === id) || null;
  const isMeshEntity = object => Boolean(object && ['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length));

  function childParts(wrapper) {
    if (!wrapper) return [];
    const ids = new Set(wrapper.ephMeshChildIds || []);
    for (const object of objects()) if (object?.type === 'part' && object.parent === wrapper.id) ids.add(object.id);
    return [...ids].map(objectById).filter(object => object?.type === 'part');
  }

  function wrapperForId(id) {
    const object = objectById(id);
    if (isMeshEntity(object)) return object;
    if (object?.ephMeshEntityChild && object.parent) {
      const parent = objectById(object.parent);
      if (isMeshEntity(parent)) return parent;
    }
    return null;
  }

  function selectedWrapper(vp) {
    return wrapperForId(vp?.selectedId) || wrapperForId(state()?.selectedId);
  }

  function primaryChild(vp, wrapper) {
    const parts = childParts(wrapper);
    return parts.find(part => vp?.objectRoots?.has?.(part.id)) || parts[0] || null;
  }

  function copyMarkers(raw, wrapped) {
    for (const key of Object.keys(raw || {})) if (key.startsWith('__eph')) wrapped[key] = raw[key];
  }

  function attachProxy(vp = installedViewport) {
    if (!vp?.transform || vp.transform.dragging) return false;
    const wrapper = selectedWrapper(vp);
    if (!wrapper) return false;
    const child = primaryChild(vp, wrapper);
    const root = child ? vp.objectRoots?.get?.(child.id) : null;
    if (!root) return false;

    if (!['move', 'rotate', 'scale'].includes(vp.tool)) {
      if (vp.transform.object === root) vp.transform.detach?.();
      return false;
    }

    if (vp.transform.object !== root) {
      if (typeof vp.attachObjectTransform === 'function') vp.attachObjectTransform(root);
      else {
        vp.transform.attach?.(root);
        vp.transform.setMode?.(vp.tool === 'move' ? 'translate' : vp.tool);
        vp.transform.setSpace?.(String(vp.space || 'Local').toLowerCase() === 'world' ? 'world' : 'local');
      }
    }
    if (vp.tool === 'scale') {
      vp.transform.setSpace?.('local');
      vp.transform.setScaleSnap?.(null);
    }
    return true;
  }

  function scheduleAttach(vp = installedViewport) {
    queueMicrotask(() => attachProxy(vp));
    requestAnimationFrame(() => attachProxy(vp));
  }

  function proxySelectedToChild(vp, callback) {
    const wrapper = selectedWrapper(vp);
    if (!wrapper || !['move', 'rotate', 'scale'].includes(vp.tool)) return callback(false, null, null);
    const child = primaryChild(vp, wrapper);
    if (!child || !vp.objectRoots?.get?.(child.id)) return callback(false, wrapper, null);

    const s = state();
    const previousViewportId = vp.selectedId;
    const previousStateId = s?.selectedId;
    vp.selectedId = child.id;
    if (vp.tool === 'scale' && s) s.selectedId = child.id;
    try {
      return callback(true, wrapper, child);
    } finally {
      vp.selectedId = previousViewportId;
      if (s) s.selectedId = previousStateId;
      if (vp.tool === 'scale') queueMicrotask(() => {
        try { renderProperties?.(); } catch {}
      });
      scheduleAttach(vp);
    }
  }

  function wrapMethod(vp, name, factory) {
    const current = vp?.[name];
    if (typeof current !== 'function' || current.__ephMeshEntityTransformV31) return false;
    const raw = current.bind(vp);
    const wrapped = factory(raw);
    copyMarkers(current, wrapped);
    wrapped.__ephMeshEntityTransformV31 = true;
    wrapped.__ephPrevious = current;
    vp[name] = wrapped;
    return true;
  }

  function wrapViewportMethods(vp) {
    wrapMethod(vp, 'select', raw => function(id, notify = true, ...rest) {
      const result = raw(id, notify, ...rest);
      scheduleAttach(this);
      return result;
    });

    wrapMethod(vp, 'setTool', raw => function(tool, ...rest) {
      const result = raw(tool, ...rest);
      scheduleAttach(this);
      return result;
    });

    wrapMethod(vp, 'setObjects', raw => function(...args) {
      const result = raw(...args);
      scheduleAttach(this);
      return result;
    });

    wrapMethod(vp, 'updateObject', raw => function(...args) {
      const result = raw(...args);
      scheduleAttach(this);
      return result;
    });

    wrapMethod(vp, 'updateSelectionBox', raw => function(...args) {
      const result = raw(...args);
      attachProxy(this);
      return result;
    });

    wrapMethod(vp, 'syncSelectedFromRoot', raw => function(doCommit, ...rest) {
      return proxySelectedToChild(this, () => raw(doCommit, ...rest));
    });

    wrapMethod(vp, 'commitObjectTransform', raw => function(...args) {
      return proxySelectedToChild(this, () => raw(...args));
    });
  }

  function restoreScalePrime() {
    if (!scalePrime) return;
    const s = state();
    if (s && s.selectedId === scalePrime.childId) s.selectedId = scalePrime.stateId;
    scalePrime = null;
  }

  function wrapTransformStart(vp) {
    const callback = vp?.callbacks?.transformStart;
    if (typeof callback !== 'function') return false;
    if (callback.__ephMeshEntityTransformV31) {
      wrappedTransformStart = callback;
      return true;
    }
    const raw = callback;
    const wrapped = function(...args) {
      const s = state();
      if (!scalePrime || !s || s.selectedId !== scalePrime.childId) return raw(...args);
      const saved = s.selectedId;
      s.selectedId = scalePrime.stateId;
      try { return raw(...args); }
      finally { s.selectedId = saved; }
    };
    copyMarkers(raw, wrapped);
    wrapped.__ephMeshEntityTransformV31 = true;
    wrapped.__ephPrevious = raw;
    vp.callbacks.transformStart = wrapped;
    wrappedTransformStart = wrapped;
    return true;
  }

  function installScalePrimer(vp) {
    if (vp.__ephMeshEntityScalePrimerV31) return;
    vp.__ephMeshEntityScalePrimerV31 = true;
    const canvas = vp.renderer?.domElement;
    if (!canvas || !vp.transform) return;

    canvas.addEventListener('pointerdown', () => {
      if (vp.tool !== 'scale' || !vp.transform.axis || vp.transform.dragging) return;
      const wrapper = selectedWrapper(vp);
      const child = primaryChild(vp, wrapper);
      const root = child ? vp.objectRoots?.get?.(child.id) : null;
      if (!wrapper || !child || !root || vp.transform.object !== root) return;
      const s = state();
      if (!s) return;
      scalePrime = { wrapperId: wrapper.id, childId: child.id, stateId: s.selectedId };
      s.selectedId = child.id;
      queueMicrotask(() => {
        if (!vp.transform.dragging) restoreScalePrime();
      });
    }, true);

    vp.transform.addEventListener('dragging-changed', () => {
      if (!scalePrime) return;
      // Scale V21 was installed before this pass. It has now captured the child
      // Part for its world-unit resize logic, so return the logical selection to
      // the entity wrapper immediately.
      restoreScalePrime();
    });
  }

  function install(vp = state()?.viewport || window.EPH3D) {
    if (!vp?.transform || !vp?.objectRoots) return false;
    installedViewport = vp;
    wrapViewportMethods(vp);
    wrapTransformStart(vp);
    installScalePrimer(vp);
    scheduleAttach(vp);
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  // Solid Entity V30 has a few delayed startup repair passes that intentionally
  // detach the generic wrapper gizmo. Keep the child-geometry proxy authoritative
  // during that bounded startup window so the tool never flashes back to 0,0,0.
  const startupGuardUntil = performance.now() + 8000;
  const startupGuard = () => {
    attachProxy(state()?.viewport || window.EPH3D);
    if (performance.now() < startupGuardUntil) requestAnimationFrame(startupGuard);
  };
  requestAnimationFrame(startupGuard);

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const vp = state()?.viewport || window.EPH3D;
    if (vp) {
      install(vp);
      if (wrappedTransformStart && vp.callbacks?.transformStart !== wrappedTransformStart) wrapTransformStart(vp);
    }
    if (checks >= 48) clearInterval(guard);
  }, 250);

  window.EPH_MESH_ENTITY_TRANSFORM_V31 = {
    attach: () => attachProxy(state()?.viewport || window.EPH3D),
    childParts,
    selectedWrapper: () => selectedWrapper(state()?.viewport || window.EPH3D),
  };

  console.info('[Mesh Entity Transform V31] Entity wrappers now move, rotate and scale through their owned Part geometry.');
})();
