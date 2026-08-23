// byanca
(() => {
  const api = window.easyPeasyHammer;
  const viewport = window.EPH3D;
  if (!api || !viewport || viewport.__ephTerrainLiveV8) return;
  viewport.__ephTerrainLiveV8 = true;

  const originalChange = viewport.callbacks.change;
  let lastSent = 0;
  let pending = null;
  let timer = null;

  const packetFor = object => ({
    id: object.id,
    type: object.type,
    vertices: structuredClone(object.vertices || []),
    size: structuredClone(object.size || [0, 0, 0]),
    position: structuredClone(object.position || [0, 0, 0]),
    rotation: structuredClone(object.rotation || [0, 0, 0]),
    scale: structuredClone(object.scale || [1, 1, 1])
  });

  const flush = async () => {
    timer = null;
    const object = pending;
    pending = null;
    if (!object || !window.EPH_COLLAB?.state?.()?.connected) return;
    lastSent = performance.now();
    try { await api.collabSendLiveObject(packetFor(object)); } catch {}
  };

  const schedule = object => {
    pending = object;
    const wait = Math.max(0, 100 - (performance.now() - lastSent));
    if (!timer) timer = setTimeout(flush, wait);
  };

  viewport.callbacks.change = function(object, commit) {
    originalChange?.(object, commit);
    if (object?.type !== 'terrain' || S.tool !== 'terrain-sculpt') return;
    if (commit) {
      pending = object;
      clearTimeout(timer);
      timer = null;
      flush();
    } else schedule(object);
  };
})();
