// byanca
(() => {
  'use strict';
  if (window.__ephLargeMapBootstrapV18) return;
  window.__ephLargeMapBootstrapV18 = true;

  const api = window.easyPeasyHammer;
  const LARGE_BYTES = 64 * 1024 * 1024;
  let installing = null;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function ensureStreamer() {
    if (window.EPH_LARGE_STREAM?.open) return window.EPH_LARGE_STREAM;
    if (installing) return installing;

    installing = (async () => {
      const started = Date.now();
      while ((!window.EPH3D || !window.THREE) && Date.now() - started < 10000) await wait(50);

      if (!window.EPH3D) throw new Error('3D viewport did not initialize before large-map streaming.');
      if (!window.THREE) throw new Error('The viewport Three.js instance was not exposed to large-map streaming. Run_Electron.bat must rebuild the viewport bundle.');

      if (!window.EPH_LARGE_STREAM?.open) {
        const old = document.querySelector('script[data-eph-pass="large-map-stream-v16.js"]');
        if (old) old.remove();
        window.__ephLargeMapStreamV16 = false;

        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'large-map-stream-v16.js';
          script.dataset.ephPass = 'large-map-stream-v16.js';
          script.async = false;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Could not load large-map-stream-v16.js.'));
          document.body.appendChild(script);
        });
      }

      const readyAt = Date.now();
      while (!window.EPH_LARGE_STREAM?.open && Date.now() - readyAt < 5000) await wait(50);
      if (!window.EPH_LARGE_STREAM?.open) {
        throw new Error(`Large-map streamer did not initialize (viewport=${Boolean(window.EPH3D)}, THREE=${Boolean(window.THREE)}, marker=${Boolean(window.__ephLargeMapStreamV16)}).`);
      }
      console.info('Large-map streaming runtime ready.');
      return window.EPH_LARGE_STREAM;
    })();

    try { return await installing; }
    catch (error) {
      console.error('Large-map streaming bootstrap failed', error);
      try { await api?.appLog?.('error', 'large-map-bootstrap', error?.message || String(error), { hasViewport: Boolean(window.EPH3D), hasThree: Boolean(window.THREE), marker: Boolean(window.__ephLargeMapStreamV16) }); } catch {}
      throw error;
    } finally { installing = null; }
  }

  async function needsStreamer(project) {
    if (!project?.vmapPath) return false;
    try {
      const inspection = await api?.inspectVmap?.(project.vmapPath);
      if (!inspection?.ok) return false;
      return inspection.encoding === 'binary' || Number(inspection.size || 0) > LARGE_BYTES;
    } catch (error) {
      console.warn('Could not inspect map for streaming bootstrap', error);
      return false;
    }
  }

  function installWrapper() {
    const current = window.loadProject;
    if (typeof current !== 'function' || !current.__ephComplexVmapV15 || current.__ephLargeBootstrapV18) return false;
    const raw = current;
    const wrapped = async function(project, ui) {
      if (await needsStreamer(project)) {
        console.info(`Preparing streamed VMAP runtime for ${project?.vmapPath || project?.name || 'map'}`);
        try { await ensureStreamer(); }
        catch (error) {
          window.toast?.('Large-map renderer could not initialize — open Logs for details');
          window.EPH_DIAGNOSTICS?.open?.();
          return false;
        }
      }
      return raw(project, ui);
    };
    wrapped.__ephComplexVmapV15 = true;
    wrapped.__ephLargeBootstrapV18 = true;
    window.loadProject = wrapped;
    try { loadProject = wrapped; } catch {}
    return true;
  }

  if (!installWrapper()) {
    setTimeout(installWrapper, 250);
    setTimeout(installWrapper, 800);
    setTimeout(installWrapper, 1800);
    setTimeout(installWrapper, 3500);
  }

  window.EPH_LARGE_BOOTSTRAP = { ensureStreamer, installWrapper };
})();
