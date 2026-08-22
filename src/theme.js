// byanca
(() => {
  const apply = viewport => {
    if (!viewport) return;
    if (viewport.scene?.background?.set) viewport.scene.background.set(0x17181b);
    if (viewport.gridHelper?.material) {
      viewport.gridHelper.material.opacity = 0.28;
      viewport.gridHelper.material.transparent = true;
    }
  };

  window.addEventListener('eph3d-ready', event => apply(event.detail));
  if (window.EPH3D) apply(window.EPH3D);
  setTimeout(() => apply(window.EPH3D), 250);
})();
