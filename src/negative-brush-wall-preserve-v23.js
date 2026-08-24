// byanca
(() => {
  'use strict';
  if (window.__ephNegativeBrushWallPreserveV23) return;
  window.__ephNegativeBrushWallPreserveV23 = true;

  // The BSP subtraction in negative-brush-v22 already contributes the cutter's
  // inward-facing polygons to A - B. Mesh Topology V36 then conforms those
  // polygons to Hammer's half-edge requirements. The old V23 pass appended a
  // second copy of cutter walls after that valid result, which created duplicate
  // same-winding edges and non-manifold vertices. Keep this compatibility pass
  // loaded so older projects/load orders remain stable, but do not synthesize
  // any additional cavity faces.
  const install = () => {
    const runtime = window.EPH_NEGATIVE_BRUSH;
    if (!runtime?.carve) return false;
    if (!runtime.carve.__ephNativeCavityV23) {
      try { runtime.carve.__ephNativeCavityV23 = true; } catch {}
      console.info('[Negative Brush Wall Preserve V23] Duplicate cavity-shell synthesis disabled. Standard BSP subtraction is authoritative.');
      try {
        window.easyPeasyHammer?.appLog?.(
          'normal',
          'negative-brush-wall-preserve-v23',
          'Standard BSP cavity surfaces are authoritative; duplicate shell synthesis is disabled.'
        )?.catch?.(() => {});
      } catch {}
    }
    return true;
  };

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
    setTimeout(() => clearInterval(timer), 30000);
  }
})();
