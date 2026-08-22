// byanca
(() => {
  const api = window.easyPeasyHammer;
  if (!api || window.__EPH_COLLAB_LIVE_SYNC) return;
  window.__EPH_COLLAB_LIVE_SYNC = true;

  const FRAME_MS = 33;
  let timer = null;
  let lastSent = 0;
  let sending = false;
  let sendAgain = false;

  function connected() {
    return Boolean(window.EPH_COLLAB?.state?.()?.connected && S?.project && S?.doc);
  }

  async function transmit(force = false) {
    if (!connected()) return;
    const now = performance.now();
    const wait = FRAME_MS - (now - lastSent);
    if (!force && wait > 0) {
      clearTimeout(timer);
      timer = setTimeout(() => transmit(false), wait);
      return;
    }
    if (sending) {
      sendAgain = true;
      return;
    }

    sending = true;
    lastSent = performance.now();
    try {
      const snapshot = window.EPH_COLLAB?.makeSnapshot?.();
      if (snapshot) await api.collabSendSnapshot(snapshot);
    } catch {}
    finally {
      sending = false;
      if (sendAgain) {
        sendAgain = false;
        setTimeout(() => transmit(false), 0);
      }
    }
  }

  function schedule() {
    if (!connected()) return;
    const now = performance.now();
    const wait = Math.max(0, FRAME_MS - (now - lastSent));
    clearTimeout(timer);
    timer = setTimeout(() => transmit(false), wait);
  }

  function installViewportHook() {
    const viewport = S?.viewport || window.EPH3D;
    if (!viewport?.callbacks) return;
    const current = viewport.callbacks.change;
    if (current?.__ephLiveSyncWrapper) return;

    const wrapped = function(object, commit) {
      current?.(object, commit);
      if (commit) transmit(true);
      else schedule();
    };
    wrapped.__ephLiveSyncWrapper = true;
    viewport.callbacks.change = wrapped;
  }

  if (typeof markDirty === 'function' && !markDirty.__ephLiveSyncWrapper) {
    const originalMarkDirty = markDirty;
    const wrappedMarkDirty = function(message) {
      originalMarkDirty(message);
      schedule();
    };
    wrappedMarkDirty.__ephLiveSyncWrapper = true;
    markDirty = wrappedMarkDirty;
  }

  window.EPH_COLLAB_LIVE_SYNC = {
    schedule,
    flush: () => transmit(true),
    fps: Math.round(1000 / FRAME_MS),
  };

  installViewportHook();
  window.addEventListener('eph3d-ready', installViewportHook);
  setInterval(installViewportHook, 250);
})();
