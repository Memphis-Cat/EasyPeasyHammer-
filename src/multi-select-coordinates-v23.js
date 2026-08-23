// byanca
(() => {
  'use strict';
  if (window.__ephMultiSelectCoordinatesV23) return;
  window.__ephMultiSelectCoordinatesV23 = true;

  let installedViewport = null;

  function ids() {
    const list = window.EPH_MULTI_SELECTION?.ids?.() || (typeof S !== 'undefined' ? S.multiSelectedIds : []) || [];
    return [...new Set(list)].filter(id => id && id !== (typeof S !== 'undefined' ? S.selectedId : null));
  }

  function syncSecondary(viewport, commit) {
    const coords = window.EPH_COORDINATES;
    if (!coords?.quaternionToQAngle || typeof S === 'undefined') return;
    for (const id of ids()) {
      const object = S.objects?.find(item => item.id === id);
      const root = viewport.objectRoots?.get?.(id);
      if (!object || !root) continue;
      object.position = [root.position.x, root.position.y, root.position.z];
      object.rotation = coords.quaternionToQAngle(root.quaternion);
      object.scale = [root.scale.x, root.scale.y, root.scale.z];
      window.EPH_VMAP?.applyObjectToDocument?.(S.doc, object);
      viewport.callbacks?.change?.(object, commit);
    }
  }

  function install(viewport = window.EPH3D || (typeof S !== 'undefined' ? S.viewport : null)) {
    if (!viewport?.transform || installedViewport === viewport) return Boolean(viewport);
    installedViewport = viewport;
    viewport.transform.addEventListener('objectChange', () => {
      if (!['move', 'rotate'].includes(viewport.tool)) return;
      if ((window.EPH_MULTI_SELECTION?.ids?.() || []).length <= 1) return;
      queueMicrotask(() => syncSecondary(viewport, false));
    });
    viewport.transform.addEventListener('dragging-changed', event => {
      if (event.value || !['move', 'rotate'].includes(viewport.tool)) return;
      if ((window.EPH_MULTI_SELECTION?.ids?.() || []).length <= 1) return;
      queueMicrotask(() => syncSecondary(viewport, true));
    });
    console.info('[Coordinates V23] Multi-selection transform rotation now writes Source 2 QAngles.');
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  const timer = setInterval(() => install(), 250);
  setTimeout(() => clearInterval(timer), 30000);
})();
