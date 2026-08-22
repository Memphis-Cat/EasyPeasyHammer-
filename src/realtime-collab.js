// byanca
(() => {
  const api = window.easyPeasyHammer;
  if (!api || window.__ephRealtimeCollab) return;
  window.__ephRealtimeCollab = true;

  const FRAME_MS = 33;
  let installedViewport = null;
  let sending = false;
  let pending = false;
  let lastSentAt = 0;
  let timer = null;

  function connected() {
    return Boolean(window.EPH_COLLAB?.state?.()?.connected && S?.project && S?.doc);
  }

  async function flush() {
    timer = null;
    if (!connected() || sending) {
      pending = true;
      return;
    }
    sending = true;
    pending = false;
    lastSentAt = performance.now();
    try {
      const snapshot = window.EPH_COLLAB?.makeSnapshot?.();
      if (snapshot) await api.collabSendSnapshot(snapshot);
    } catch {}
    finally {
      sending = false;
      if (pending && connected()) requestLiveSync();
    }
  }

  function requestLiveSync(immediate = false) {
    if (!connected()) return;
    pending = true;
    if (sending) return;
    const wait = immediate ? 0 : Math.max(0, FRAME_MS - (performance.now() - lastSentAt));
    clearTimeout(timer);
    timer = setTimeout(flush, wait);
  }

  function install(viewport) {
    if (!viewport || installedViewport === viewport || viewport.__ephRealtimeCollab) return;
    installedViewport = viewport;
    viewport.__ephRealtimeCollab = true;

    const previousChange = viewport.callbacks.change;
    viewport.callbacks.change = (object, commit) => {
      previousChange?.(object, commit);
      requestLiveSync(Boolean(commit));
    };

    const transform = viewport.transform;
    if (transform?.addEventListener) {
      transform.addEventListener('objectChange', () => requestLiveSync(false));
      transform.addEventListener('dragging-changed', event => {
        if (!event.value) requestLiveSync(true);
      });
    }
  }

  setInterval(() => install(S?.viewport || window.EPH3D), 120);
  if (window.EPH3D) install(window.EPH3D);
  window.addEventListener('eph3d-ready', event => install(event.detail));

  window.EPH_COLLAB_LIVE = { request: requestLiveSync, frameMs: FRAME_MS };
})();
