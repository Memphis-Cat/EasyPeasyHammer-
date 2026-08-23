// byanca
(() => {
  'use strict';
  if (window.__ephScaleLegacyDisableV21) return;
  window.__ephScaleLegacyDisableV21 = true;

  function disableOldScaleUi() {
    const viewport = window.EPH3D || (typeof S !== 'undefined' ? S?.viewport : null);
    if (viewport && !viewport.__ephLegacyScaleModeDisabledV21) {
      viewport.__ephLegacyScaleModeDisabledV21 = true;
      try {
        Object.defineProperty(viewport, 'scaleResizeMode', {
          configurable: true,
          enumerable: false,
          get: () => '__v21__',
          set: () => {},
        });
      } catch { viewport.scaleResizeMode = '__v21__'; }
    }

    const oldMode = document.getElementById('ephScaleMode');
    const oldHost = oldMode?.closest?.('.eph-scale-option, .eph-transform-option');
    if (oldHost) oldHost.remove();
    else oldMode?.remove();
    document.getElementById('ephScaleSide')?.remove();
  }

  disableOldScaleUi();
  const timer = setInterval(disableOldScaleUi, 200);
  setTimeout(() => clearInterval(timer), 30000);
  window.addEventListener('eph3d-ready', disableOldScaleUi);
})();
