// byanca
(() => {
  'use strict';
  if (window.__ephSelectClickCaptureV40) return;
  window.__ephSelectClickCaptureV40 = true;

  const state = () => (typeof S !== 'undefined' ? S : window.S);

  function install(viewport = window.EPH3D || state()?.viewport) {
    const canvas = viewport?.renderer?.domElement;
    if (!canvas || canvas.dataset.ephSelectClickCaptureV40 === '1') return false;
    canvas.dataset.ephSelectClickCaptureV40 = '1';

    // Register on window capture: this runs before the old canvas handler that
    // starts a box-selection when its first-hit lookup cannot resolve a helper.
    window.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target !== canvas) return;
      if ((viewport.tool || state()?.tool) !== 'select') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const id = window.EPH_SURFACE_MOVE_V39?.selectAt?.(event);
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

    console.info('[Select Click V40] Parts, props, entities and particle helpers are captured before legacy box selection.');
    return true;
  }

  install();
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });
  window.addEventListener('eph3d-ready', event => install(event.detail));
})();
