// byanca
(() => {
  'use strict';
  if (window.__ephVisualCleanV16) return;
  window.__ephVisualCleanV16 = true;

  function install(viewport = (typeof S !== 'undefined' ? S?.viewport : null) || window.EPH3D) {
    const THREE = window.EPH_THREE || window.THREE;
    if (!viewport || !THREE) return false;

    // Do not force the canvas itself to black. The old rule made a detached
    // scene, a 1x1 WebGL backing buffer and a bad camera all look identical.
    // Keep a charcoal editor background so the Hammer grid remains visible.
    viewport.scene.background = new THREE.Color(0x111318);
    try { viewport.renderer.setClearColor(0x111318, 1); } catch {}

    if (viewport.__ephCleanEntityHelpersV16 || typeof viewport.createEntityMarker !== 'function') return true;
    viewport.__ephCleanEntityHelpersV16 = true;
    const raw = viewport.createEntityMarker.bind(viewport);
    viewport.createEntityMarker = function(object) {
      const visual = raw(object);
      visual?.traverse?.(node => {
        if (node.userData?.ephLightRange) node.visible = false;
      });
      return visual;
    };
    return true;
  }

  if (!install()) {
    const onReady = event => install(event.detail);
    window.addEventListener('eph3d-ready', onReady, { once: true });
  }
})();
