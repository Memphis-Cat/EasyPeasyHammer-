// byanca
(() => {
  'use strict';
  if (window.__ephSelectClickCaptureV40) return;
  window.__ephSelectClickCaptureV40 = true;

  const state = () => (typeof S !== 'undefined' ? S : window.S);

  function clearSelection(viewport) {
    const multi = window.EPH_MULTI_SELECTION;
    if (multi?.clear) {
      try { multi.clear(); } catch {}
      return;
    }

    const s = state();
    try { viewport.select?.(null, false); } catch {}
    viewport.selectedId = null;
    viewport.multiSelectedIds = [];
    viewport.transform?.detach?.();
    if (viewport.selectionBox) viewport.selectionBox.visible = false;
    if (s) {
      s.selectedId = null;
      s.multiSelectedIds = [];
      s.selectedFaces = new Set();
      s.subSelection = null;
    }
    try { window.EPH_HAMMER_SELECTION_V46?.clear?.(); } catch {}
    try { renderTree?.(); renderProperties?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('eph-selection-changed', { detail: { ids: [], primary: null } })); } catch {}
  }

  function selectSingle(viewport, id) {
    const multi = window.EPH_MULTI_SELECTION;
    if (multi?.set) {
      try { viewport.select?.(id, false); } catch {}
      try { multi.set([id], id, { selectViewport: false }); } catch {}
      return;
    }

    try { viewport.select?.(id, false); } catch {}
    const s = state();
    viewport.multiSelectedIds = id ? [id] : [];
    if (s) {
      s.selectedId = id;
      s.multiSelectedIds = id ? [id] : [];
      s.selectedFaces = id ? new Set([0]) : new Set();
      s.subSelection = null;
    }
    try { renderTree?.(); renderProperties?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('eph-selection-changed', { detail: { ids: id ? [id] : [], primary: id || null } })); } catch {}
  }

  function install(viewport = window.EPH3D || state()?.viewport) {
    const canvas = viewport?.renderer?.domElement;
    if (!canvas || canvas.dataset.ephSelectClickCaptureV40 === '1') return false;
    canvas.dataset.ephSelectClickCaptureV40 = '1';
    let emptyPress = null;

    window.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target !== canvas) return;
      if ((viewport.tool || state()?.tool) !== 'select') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const id = window.EPH_SURFACE_MOVE_V39?.selectAt?.(event);
      if (!id) {
        emptyPress = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        clearSelection(viewport);
        return;
      }

      emptyPress = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectSingle(viewport, id);
      queueMicrotask(() => window.EPH_HAMMER_SELECTION_V46?.rebuild?.(viewport, true));
    }, true);

    window.addEventListener('pointerup', event => {
      if (!emptyPress || event.pointerId !== emptyPress.pointerId) return;
      const press = emptyPress;
      emptyPress = null;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (moved > 5 || event.target !== canvas) return;
      if ((viewport.tool || state()?.tool) !== 'select') return;

      const id = window.EPH_SURFACE_MOVE_V39?.selectAt?.(event);
      if (id) return;
      queueMicrotask(() => clearSelection(viewport));
    }, true);

    window.addEventListener('pointercancel', () => { emptyPress = null; }, true);

    console.info('[Select Click V40] Viewport clicks now update primary and multi-selection atomically; empty clicks clear both.');
    return true;
  }

  install();
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });
  window.addEventListener('eph3d-ready', event => install(event.detail));
})();
