// byanca
(() => {
  'use strict';
  if (window.__ephEntityTransformPersistenceV33) return;
  window.__ephEntityTransformPersistenceV33 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  let installedViewport = null;
  let wrappedPrepare = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const objects = () => state()?.objects || [];
  const objectById = id => objects().find(object => object?.id === id) || null;
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const isMeshWrapper = object => Boolean(object && ['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length));
  const isTransformTarget = object => Boolean(
    object?.dmxId
    && ['part', 'entity', 'prop'].includes(object.type)
    && !isMeshWrapper(object)
  );

  function qAngleFromRoot(root) {
    const converter = window.EPH_COORDINATES?.quaternionToQAngle;
    if (typeof converter === 'function' && root?.quaternion) {
      const value = converter(root.quaternion);
      if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3).map(item => finite(item));
    }
    const rotation = root?.rotation;
    if (!rotation) return [0, 0, 0];
    return [finite(rotation.x) * 180 / Math.PI, finite(rotation.y) * 180 / Math.PI, finite(rotation.z) * 180 / Math.PI];
  }

  function syncObjectFromRoot(object, root, write = true) {
    if (!isTransformTarget(object) || !root) return false;
    object.position = [finite(root.position?.x), finite(root.position?.y), finite(root.position?.z)];
    object.rotation = qAngleFromRoot(root);
    object.scale = [finite(root.scale?.x, 1), finite(root.scale?.y, 1), finite(root.scale?.z, 1)];
    if (write && state()?.doc) VMAP.applyObjectToDocument?.(state().doc, object);
    return true;
  }

  function syncSelected(vp = installedViewport, write = true) {
    if (!vp?.objectRoots) return false;
    let object = objectById(vp.selectedId) || objectById(state()?.selectedId);
    if (isMeshWrapper(object)) {
      const ids = new Set(object.ephMeshChildIds || []);
      for (const child of objects()) if (child?.type === 'part' && child.parent === object.id) ids.add(child.id);
      object = [...ids].map(objectById).find(child => child && vp.objectRoots.has(child.id)) || null;
    }
    if (!isTransformTarget(object)) return false;
    const root = vp.objectRoots.get(object.id);
    return syncObjectFromRoot(object, root, write);
  }

  function syncAllLive(vp = installedViewport, write = true) {
    if (!vp?.objectRoots) return 0;
    let count = 0;
    for (const object of objects()) {
      if (!isTransformTarget(object)) continue;
      const root = vp.objectRoots.get(object.id);
      if (root && syncObjectFromRoot(object, root, write)) count++;
    }
    return count;
  }

  function copyMarkers(raw, wrapped) {
    for (const key of Object.keys(raw || {})) if (key.startsWith('__eph')) wrapped[key] = raw[key];
  }

  function wrapViewportMethod(vp, name) {
    const current = vp?.[name];
    if (typeof current !== 'function' || current.__ephEntityTransformPersistenceV33) return;
    const raw = current.bind(vp);
    const wrapped = function(...args) {
      const result = raw(...args);
      syncSelected(this, true);
      if (name === 'syncSelectedFromRoot' && Boolean(args[0])) queueMicrotask(() => {
        try { renderProperties?.(); } catch {}
      });
      return result;
    };
    copyMarkers(current, wrapped);
    wrapped.__ephEntityTransformPersistenceV33 = true;
    wrapped.__ephPrevious = current;
    vp[name] = wrapped;
  }

  function installViewport(vp = state()?.viewport || window.EPH3D) {
    if (!vp?.objectRoots || !vp?.transform) return false;
    installedViewport = vp;
    wrapViewportMethod(vp, 'syncSelectedFromRoot');
    wrapViewportMethod(vp, 'commitObjectTransform');

    if (!vp.__ephEntityTransformDragV33) {
      vp.__ephEntityTransformDragV33 = true;
      vp.transform.addEventListener('dragging-changed', event => {
        if (event.value) return;
        syncSelected(vp, true);
      });
    }
    return true;
  }

  function installPrepare() {
    const current = VMAP.prepareForSave;
    if (typeof current !== 'function') return false;
    if (current.__ephEntityTransformPersistenceV33) {
      wrappedPrepare = current;
      return true;
    }
    const raw = current.bind(VMAP);
    const wrapped = function(doc, list, ...rest) {
      syncAllLive(state()?.viewport || window.EPH3D, true);
      return raw(doc, list, ...rest);
    };
    wrapped.__ephEntityTransformPersistenceV33 = true;
    wrapped.__ephPrevious = current;
    VMAP.prepareForSave = wrapped;
    wrappedPrepare = wrapped;
    return true;
  }

  function install() {
    installViewport();
    installPrepare();
  }

  install();
  window.addEventListener('eph3d-ready', event => { installViewport(event.detail); installPrepare(); });
  window.addEventListener('eph-runtime-ready', install, { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    installViewport();
    if (wrappedPrepare && VMAP.prepareForSave !== wrappedPrepare) installPrepare();
    if (checks >= 40) clearInterval(guard);
  }, 250);

  window.EPH_ENTITY_TRANSFORM_PERSISTENCE_V33 = { syncSelected, syncAll: syncAllLive };
  console.info('[Entity Transform Persistence V33] Parts, mesh-entity geometry, point entities and particles force position/rotation/scale from the live viewport into VMAP on commit and save.');
})();
