// byanca
(() => {
  'use strict';
  if (window.__ephSelectionSyncV48) return;
  window.__ephSelectionSyncV48 = true;

  let installedViewport = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const objectFor = id => state()?.objects?.find(object => object?.id === id) || null;

  function copyMarkers(target, source) {
    for (const property of Object.keys(source || {})) if (property.startsWith('__eph')) target[property] = source[property];
  }

  function syncDirectSelection(viewport, id) {
    const multi = window.EPH_MULTI_SELECTION;
    const object = objectFor(id);
    if (!multi?.set) return;

    if (object && !['world', 'folder'].includes(object.type)) {
      multi.set([id], id, { selectViewport: false });
    } else if (object && multi.setPrimaryOnly) {
      multi.setPrimaryOnly(id, { selectViewport: false });
    } else {
      multi.set([], null, { selectViewport: false });
    }
    viewport.multiSelectedIds = [...(state()?.multiSelectedIds || [])];
  }

  function looksCanonical(id) {
    const s = state();
    const ids = Array.isArray(s?.multiSelectedIds) ? s.multiSelectedIds : [];
    if (!id) return !s?.selectedId && !ids.length;
    const object = objectFor(id);
    if (object && ['world', 'folder'].includes(object.type)) return s?.selectedId === id && !ids.length;
    return s?.selectedId === id && ids.includes(id);
  }

  function updateBlueHelpers(viewport) {
    const fast = window.EPH_MULTI_SELECTION?.updateHelpers;
    if (typeof fast === 'function') {
      try { fast(); } catch {}
      return;
    }

    // Startup fallback only. V49 replaces this with a direct helper map so a
    // transform never has to walk the entire Three.js scene.
    for (const node of viewport?.scene?.children || []) {
      if (!node?.userData?.ephMultiSelection) continue;
      try { node.update?.(); } catch {}
    }
  }

  function selected(id) {
    const s = state();
    return Boolean(id && (s?.selectedId === id || (Array.isArray(s?.multiSelectedIds) && s.multiSelectedIds.includes(id))));
  }

  function install(viewport = window.EPH3D || state()?.viewport) {
    if (!viewport?.select || !viewport?.setObjects) return false;
    if (viewport.__ephSelectionSyncV48) {
      installedViewport = viewport;
      return true;
    }
    viewport.__ephSelectionSyncV48 = true;
    installedViewport = viewport;

    let insideSetObjects = 0;

    const previousSetObjects = viewport.setObjects;
    const wrappedSetObjects = function(...args) {
      insideSetObjects++;
      try { return previousSetObjects.apply(this, args); }
      finally { insideSetObjects--; }
    };
    copyMarkers(wrappedSetObjects, previousSetObjects);
    wrappedSetObjects.__ephSelectionSyncV48 = true;
    wrappedSetObjects.__ephPrevious = previousSetObjects;
    viewport.setObjects = wrappedSetObjects;

    const previousSelect = viewport.select;
    const wrappedSelect = function(id, ...rest) {
      const result = previousSelect.call(this, id, ...rest);
      if (insideSetObjects) return result;

      const finalId = this.selectedId ?? id ?? null;
      if (!looksCanonical(finalId)) {
        syncDirectSelection(this, finalId);
      }
      return result;
    };
    copyMarkers(wrappedSelect, previousSelect);
    wrappedSelect.__ephSelectionSyncV48 = true;
    wrappedSelect.__ephPrevious = previousSelect;
    viewport.select = wrappedSelect;

    if (viewport.transform) {
      let helperFrame = 0;
      const schedule = () => {
        if (helperFrame) return;
        helperFrame = requestAnimationFrame(() => {
          helperFrame = 0;
          updateBlueHelpers(viewport);
        });
      };
      viewport.transform.addEventListener?.('objectChange', schedule);
      viewport.transform.addEventListener?.('change', schedule);
      viewport.transform.addEventListener?.('dragging-changed', schedule);
    }

    if (typeof viewport.updateObject === 'function') {
      const previousUpdateObject = viewport.updateObject;
      const wrappedUpdateObject = function(object, ...rest) {
        const result = previousUpdateObject.call(this, object, ...rest);
        if (selected(object?.id)) queueMicrotask(() => window.EPH_MULTI_SELECTION?.refresh?.());
        return result;
      };
      copyMarkers(wrappedUpdateObject, previousUpdateObject);
      wrappedUpdateObject.__ephSelectionSyncV48 = true;
      wrappedUpdateObject.__ephPrevious = previousUpdateObject;
      viewport.updateObject = wrappedUpdateObject;
    }

    console.info('[Selection Sync V48] Direct, Scene and multi-selection state use frame-batched helper updates.');
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  window.EPH_SELECTION_SYNC_V48 = { install };
})();
