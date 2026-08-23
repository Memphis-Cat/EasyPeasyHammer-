// byanca
(() => {
  'use strict';
  if (window.__ephNegativeBrushSafetyV22) return;
  window.__ephNegativeBrushSafetyV22 = true;

  const VMAP = window.EPH_VMAP;
  let installed = false;

  const clone = value => {
    try { return structuredClone(value); }
    catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
  };

  function capture() {
    if (!S?.doc) return null;
    return {
      text: VMAP.stringify(S.doc),
      extras: typeof extras === 'function' ? clone(extras()) : null,
      selectedId: S.selectedId,
      selectedFaces: [...(S.selectedFaces || [])],
      multi: window.EPH_MULTI_SELECTION?.ids?.() || clone(S.multiSelectedIds || []),
    };
  }

  function restore(snapshot) {
    if (!snapshot) return;
    S.doc = VMAP.parse(snapshot.text);
    S.objects = VMAP.extractObjects(S.doc).map(ensureObject);
    if (snapshot.extras && typeof applyExtras === 'function') applyExtras(snapshot.extras);
    S.selectedId = S.objects.some(object => object.id === snapshot.selectedId) ? snapshot.selectedId : 'world';
    S.selectedFaces = new Set(snapshot.selectedFaces?.length ? snapshot.selectedFaces : [0]);
    S.subSelection = null;
    const ids = (snapshot.multi || []).filter(id => S.objects.some(object => object.id === id));
    window.EPH_MULTI_SELECTION?.set?.(ids, ids.includes(S.selectedId) ? S.selectedId : ids.at(-1), { render: false });
    renderAll?.();
    S.viewport?.setObjects?.(S.objects, S.selectedId);
  }

  function install() {
    const runtime = window.EPH_NEGATIVE_BRUSH;
    if (installed || !runtime?.carve) return installed;
    const rawCarve = runtime.carve;
    const safeCarve = function() {
      const snapshot = capture();
      let result = false;
      try {
        result = rawCarve();
      } catch (error) {
        console.error('[Negative Brush Safety V22] CSG threw', error);
        result = false;
      }
      if (!result) restore(snapshot);
      return result;
    };
    runtime.carve = safeCarve;

    document.addEventListener('click', event => {
      const button = event.target?.closest?.('#ephNegativeCarve');
      if (!button || button.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      safeCarve();
    }, true);

    installed = true;
    console.info('[Negative Brush Safety V22] Atomic carve guard installed.');
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 150);
    setTimeout(() => clearInterval(timer), 30000);
  }
})();
