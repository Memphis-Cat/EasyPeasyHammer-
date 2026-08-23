// byanca
(() => {
  'use strict';
  if (window.__ephLargeMapBootstrapV21) return;
  window.__ephLargeMapBootstrapV21 = true;

  const api = window.easyPeasyHammer;
  const LARGE_BYTES = 64 * 1024 * 1024;
  let installing = null;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function ensureStreamer() {
    if (window.EPH_LARGE_STREAM?.open && window.__ephLargeMapStreamV21) return window.EPH_LARGE_STREAM;
    if (installing) return installing;
    installing = (async () => {
      const started = Date.now();
      while ((!window.EPH3D || !(window.EPH_THREE || window.THREE)) && Date.now() - started < 10000) await wait(50);
      if (!window.EPH3D) throw new Error('3D viewport did not initialize before large-map streaming.');
      if (!(window.EPH_THREE || window.THREE)) throw new Error('The viewport Three.js instance was not exposed to large-map streaming.');
      if (!window.EPH_LARGE_STREAM?.open || !window.__ephLargeMapStreamV21) {
        document.querySelector('script[data-eph-pass="large-map-stream-v21.js"]')?.remove();
        window.__ephLargeMapStreamV21 = false;
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'large-map-stream-v21.js'; script.dataset.ephPass = 'large-map-stream-v21.js'; script.async = false;
          script.onload = resolve; script.onerror = () => reject(new Error('Could not load large-map-stream-v21.js.'));
          document.body.appendChild(script);
        });
      }
      const ready = Date.now();
      while ((!window.EPH_LARGE_STREAM?.open || !window.__ephLargeMapStreamV21) && Date.now() - ready < 5000) await wait(50);
      if (!window.EPH_LARGE_STREAM?.open) throw new Error('Large-map V21 streamer did not initialize.');
      return window.EPH_LARGE_STREAM;
    })();
    try { return await installing; }
    catch (error) {
      console.error('Large-map V21 bootstrap failed', error);
      try { await api?.appLog?.('error', 'large-map-bootstrap-v21', error?.message || String(error), { viewport: Boolean(window.EPH3D), three: Boolean(window.EPH_THREE || window.THREE) }); } catch {}
      throw error;
    } finally { installing = null; }
  }

  async function needsStreamer(project) {
    if (!project?.vmapPath) return false;
    try {
      const inspection = await api?.inspectVmap?.(project.vmapPath);
      return Boolean(inspection?.ok && (inspection.encoding === 'binary' || Number(inspection.size || 0) > LARGE_BYTES));
    } catch { return false; }
  }

  function installWrapper() {
    const current = window.loadProject;
    if (typeof current !== 'function' || !current.__ephComplexVmapV15 || current.__ephLargeBootstrapV21) return false;
    const raw = current;
    const wrapped = async function(project, ui) {
      if (await needsStreamer(project)) {
        try { await ensureStreamer(); }
        catch {
          window.toast?.('Large-map renderer could not initialize — open Logs for details');
          window.EPH_DIAGNOSTICS?.open?.();
          return false;
        }
      }
      return raw(project, ui);
    };
    wrapped.__ephComplexVmapV15 = true; wrapped.__ephLargeBootstrapV21 = true;
    window.loadProject = wrapped; try { loadProject = wrapped; } catch {}
    return true;
  }

  installWrapper();
  [250,800,1800,3500].forEach(ms => setTimeout(installWrapper, ms));
  window.EPH_LARGE_BOOTSTRAP = { ensureStreamer, installWrapper };
})();
