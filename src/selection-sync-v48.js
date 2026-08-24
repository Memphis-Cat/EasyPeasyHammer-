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
    viewport?.scene?.traverse?.(node => {
      if (node?.userData?.ephMultiSelection) {
        try { node.update?.(); } catch {}
      }
    });
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

    // setObjects has its own explicit selection reconciliation in multi-select.
    // Its internal select() must never collapse an existing valid group.
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
        // Placement tools and legacy code often assign S.selectedId and call
        // viewport.select directly without touching multiSelectedIds. Repair
        // that immediately so blue/yellow/tree selection cannot split apart.
        syncDirectSelection(this, finalId);
      }
      return result;
    };
    copyMarkers(wrappedSelect, previousSelect);
    wrappedSelect.__ephSelectionSyncV48 = true;
    wrappedSelect.__ephPrevious = previousSelect;
    viewport.select = wrappedSelect;

    // BoxHelper does not update itself when its target moves/scales. Keeping the
    // blue helpers live here fixes the old "yellow moved but blue stayed behind"
    // bug during normal one-object transforms as well as multi-transforms.
    if (viewport.transform) {
      viewport.transform.addEventListener?.('objectChange', () => updateBlueHelpers(viewport));
      viewport.transform.addEventListener?.('change', () => updateBlueHelpers(viewport));
      viewport.transform.addEventListener?.('dragging-changed', () => updateBlueHelpers(viewport));
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

    console.info('[Selection Sync V48] Direct, Scene and multi-selection state plus live blue bounds now share one canonical selection.');
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  window.EPH_SELECTION_SYNC_V48 = { install };
})();
