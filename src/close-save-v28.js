// byanca
(() => {
  'use strict';
  if (window.__ephCloseSaveV28) return;
  window.__ephCloseSaveV28 = true;

  const api = window.easyPeasyHammer;
  if (!api?.onPrepareClose || !api?.closeReady) return;
  let closing = false;

  api.onPrepareClose(async () => {
    if (closing) return;
    closing = true;
    try {
      clearTimeout(S?.autosaveTimer);
      if (S?.project && S?.doc) {
        if (window.EPH_LARGE_STREAM?.active?.() && S.dirty) {
          await window.EPH_LARGE_STREAM.save?.(false);
        }
        await api.autosave({ project: S.project, uiState: uiSnapshot() });
      }
    } catch (error) {
      try { console.error('[Close Save V28] Final autosave failed.', error); } catch {}
    } finally {
      try { await api.closeReady(); } catch {}
    }
  });
})();
