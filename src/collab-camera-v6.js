// byanca
(() => {
  const api = window.easyPeasyHammer;
  if (!api || window.__ephCollabCameraV6) return;
  window.__ephCollabCameraV6 = true;

  let lastSignature = '';
  let lastSent = 0;

  function signature(camera) {
    const values = [...(camera?.position || []), ...(camera?.target || [])];
    return values.map(value => Number(value || 0).toFixed(2)).join('|');
  }

  function tick() {
    const collab = window.EPH_COLLAB?.state?.();
    const viewport = window.EPH3D;
    if (collab?.connected && viewport?.getCameraState) {
      const camera = viewport.getCameraState();
      const next = signature(camera);
      const now = performance.now();
      if (next && next !== lastSignature && now - lastSent >= 30) {
        lastSignature = next;
        lastSent = now;
        api.collabSendCursor?.({ camera }).catch?.(() => {});
      }
    }
    setTimeout(tick, 30);
  }

  tick();
})();
