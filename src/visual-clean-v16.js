// byanca
(() => {
  'use strict';
  if (window.__ephVisualCleanV16) return;
  window.__ephVisualCleanV16 = true;

  const THREE = window.THREE;
  const style = document.createElement('style');
  style.textContent = `#threeViewport, #threeViewport canvas, #viewport { background:#000 !important; }`;
  document.head.appendChild(style);

  function install(viewport = S?.viewport || window.EPH3D) {
    if (!viewport || !THREE) return;
    viewport.scene.background = new THREE.Color(0x000000);
    try { viewport.renderer.setClearColor(0x000000, 1); } catch {}
    if (viewport.__ephCleanEntityHelpersV16 || typeof viewport.createEntityMarker !== 'function') return;
    viewport.__ephCleanEntityHelpersV16 = true;
    const raw = viewport.createEntityMarker.bind(viewport);
    viewport.createEntityMarker = function(object) {
      const visual = raw(object);
      visual?.traverse?.(node => {
        if (node.userData?.ephLightRange) node.visible = false;
      });
      return visual;
    };
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail), { once: true });
})();
