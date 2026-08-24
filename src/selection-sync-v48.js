// byanca
(() => {
  'use strict';
  if (window.__ephSelectionSyncV48) return;
  window.__ephSelectionSyncV48 = true;

  let selectionEpoch = 0;
  let installedViewport = null;
  window.addEventListener('eph-selection-changed', () => { selectionEpoch++; });

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

    // The synchronizer is only for state ownership. Do not call viewport.select
    // again here or we would recursively re-enter the wrapper below.
    viewport.multiSelectedIds = [...(state()?.multiSelectedIds || [])];
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

    // setObjects already has an explicit selectedId and multi-select-v22 has a
    // dedicated reconciliation pass for it. Suppress the select() call that the
    // viewport performs internally so it cannot collapse a valid multi-select.
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
      const epochBefore = selectionEpoch;
      const result = previousSelect.call(this, id, ...rest);
      if (insideSetObjects) return result;

      queueMicrotask(() => {
        // Canonical Scene/multi-select operations call viewport.select first and
        // then synchronously emit eph-selection-changed. If that happened, the
        // selection is already authoritative and must not be collapsed here.
        if (selectionEpoch !== epochBefore) return;
        const finalId = this.selectedId ?? id ?? null;
        syncDirectSelection(this, finalId);
      });
      return result;
    };
    copyMarkers(wrappedSelect, previousSelect);
    wrappedSelect.__ephSelectionSyncV48 = true;
    wrappedSelect.__ephPrevious = previousSelect;
    viewport.select = wrappedSelect;

    console.info('[Selection Sync V48] Direct viewport, placement, Scene and multi-selection state now share one canonical selection.');
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  window.EPH_SELECTION_SYNC_V48 = { install };
})();
