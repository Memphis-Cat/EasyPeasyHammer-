// byanca
(() => {
  'use strict';
  if (window.__ephSelectClickCaptureV40) return;
  window.__ephSelectClickCaptureV40 = true;

  const state = () => (typeof S !== 'undefined' ? S : window.S);

  function clearSelection(viewport) {
    const s = state();
    try { viewport.select?.(null, false); } catch {}
    viewport.selectedId = null;
    viewport.transform?.detach?.();
    if (s) {
      s.selectedId = null;
      s.selectedFaces = new Set();
      s.subSelection = null;
    }
    try { window.EPH_HAMMER_SELECTION_V46?.clear?.(); } catch {}
    try { renderTree?.(); renderProperties?.(); } catch {}
  }

  function install(viewport = window.EPH3D || state()?.viewport) {
    const canvas = viewport?.renderer?.domElement;
    if (!canvas || canvas.dataset.ephSelectClickCaptureV40 === '1') return false;
    canvas.dataset.ephSelectClickCaptureV40 = '1';
    let emptyPress = null;

    // Register on window capture: this runs before the old canvas handler that
    // starts a box-selection when its first-hit lookup cannot resolve a helper.
    window.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target !== canvas) return;
      if ((viewport.tool || state()?.tool) !== 'select') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const id = window.EPH_SURFACE_MOVE_V39?.selectAt?.(event);
      if (!id) {
        // Clear immediately for normal empty clicks, then verify again on
        // pointerup. We deliberately do not stop propagation here so marquee
        // selection can still begin if the user actually drags.
        emptyPress = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        clearSelection(viewport);
        return;
      }

      emptyPress = null;
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
      queueMicrotask(() => window.EPH_HAMMER_SELECTION_V46?.rebuild?.(viewport, true));
    }, true);

    window.addEventListener('pointerup', event => {
      if (!emptyPress || event.pointerId !== emptyPress.pointerId) return;
      const press = emptyPress;
      emptyPress = null;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (moved > 5 || event.target !== canvas) return;
      if ((viewport.tool || state()?.tool) !== 'select') return;

      // The legacy select/marquee handler may have run between pointerdown and
      // pointerup. Resolve the final click again and make an actual empty click
      // authoritative after the event finishes propagating.
      const id = window.EPH_SURFACE_MOVE_V39?.selectAt?.(event);
      if (id) return;
      queueMicrotask(() => clearSelection(viewport));
    }, true);

    window.addEventListener('pointercancel', () => { emptyPress = null; }, true);

    console.info('[Select Click V40] Parts, props, entities and particle helpers select directly; empty clicks deselect.');
    return true;
  }

  install();
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });
  window.addEventListener('eph3d-ready', event => install(event.detail));
})();
