// byanca
(() => {
  'use strict';

  if (window.__ephComplexVmapV15 || typeof window.loadProject !== 'function') return;
  window.__ephComplexVmapV15 = true;

  const api = window.easyPeasyHammer;
  const rawLoadProject = window.loadProject;
  const LARGE_TEXT_BYTES = 64 * 1024 * 1024;
  let cancelled = false;
  let loading = false;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'complex-vmap-v15.css';
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'ephComplexVmapLoading';
  overlay.className = 'eph-complex-vmap-loading';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="eph-complex-vmap-loading-card">
      <div class="eph-complex-vmap-spinner"></div>
      <strong id="ephComplexVmapLoadingTitle">Loading VMAP…</strong>
      <button id="ephComplexVmapCancel" type="button" aria-label="Cancel loading" title="Cancel">×</button>
    </div>`;
  document.body.appendChild(overlay);

  const title = overlay.querySelector('#ephComplexVmapLoadingTitle');
  const cancelButton = overlay.querySelector('#ephComplexVmapCancel');

  function trace(message, data = null, level = 'normal') {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[VMAP] ${message}`, data || '');
    api?.appLog?.(level, 'vmap-loader', message, data).catch?.(() => {});
  }

  function showLoading(text = 'Loading VMAP…') {
    cancelled = false;
    loading = true;
    title.textContent = text;
    overlay.hidden = false;
    trace(text);
  }
  function setStage(text) {
    if (!overlay.hidden) title.textContent = text || 'Loading VMAP…';
    if (text) trace(text);
  }
  function hideLoading() { loading = false; overlay.hidden = true; }

  cancelButton.onclick = async () => {
    if (!loading) return;
    cancelled = true;
    cancelButton.disabled = true;
    setStage('Cancelling…');
    try { await api.cancelVmapLoad?.(); } catch (error) { trace('Cancel request failed', error, 'warning'); }
    hideLoading();
    cancelButton.disabled = false;
    window.log?.('VMAP load cancelled', 'normal');
    trace('VMAP load cancelled');
  };

  api.onVmapLoadProgress?.(event => {
    if (!loading || cancelled) return;
    const label = { convert: 'Converting VMAP…', 'convert-retry': 'Retrying VMAP conversion…', index: 'Indexing map…', parse: 'Reading map…', ready: 'Opening map…' }[event?.stage];
    if (label) setStage(label);
    trace(`Progress event: ${event?.stage || 'unknown'}`, event);
  });

  async function getStreamer() {
    if (window.EPH_LARGE_STREAM?.open) return window.EPH_LARGE_STREAM;
    trace('Large-map streamer not ready; invoking bootstrap.', { hasViewport: Boolean(window.EPH3D), hasThree: Boolean(window.THREE), marker: Boolean(window.__ephLargeMapStreamV16) }, 'warning');
    const boot = window.EPH_LARGE_BOOTSTRAP?.ensureStreamer;
    if (typeof boot === 'function') {
      try {
        const stream = await boot();
        if (stream?.open) return stream;
      } catch (error) {
        trace('Large-map bootstrap failed.', error, 'error');
      }
    }
    // Bounded fallback for the very early startup case where the bootstrap pass
    // has not executed yet but the streamer script is still loading from disk.
    const started = Date.now();
    while (!window.EPH_LARGE_STREAM?.open && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 50));
    return window.EPH_LARGE_STREAM || null;
  }

  async function openStreamed(project, decoded, ui) {
    const stream = await getStreamer();
    if (!stream?.open) {
      const detail = { hasViewport: Boolean(window.EPH3D), hasThree: Boolean(window.THREE), streamMarker: Boolean(window.__ephLargeMapStreamV16), bootstrap: Boolean(window.EPH_LARGE_BOOTSTRAP) };
      trace('Large-map streaming renderer is unavailable after bootstrap/wait.', detail, 'error');
      window.EPH_DIAGNOSTICS?.open?.();
      throw new Error('Large-map streaming renderer is unavailable. Open Logs for the full startup/runtime trace.');
    }
    setStage('Opening map…');
    trace('Opening streamed map.', { path: project?.vmapPath, meshes: decoded?.meshCount, entities: decoded?.entityCount, decodedBytes: decoded?.decodedBytes, token: decoded?.largeMapToken ? '<present>' : '<missing>' });
    const ok = await stream.open(rawLoadProject, project, decoded, ui);
    if (ok) {
      window.log?.(`Opened ${project.vmapPath} (${Number(decoded.meshCount || 0).toLocaleString()} meshes, ${Number(decoded.entityCount || 0).toLocaleString()} entities)`, 'normal');
      trace('Streamed map opened.', { meshes: decoded.meshCount, entities: decoded.entityCount });
    } else trace('Streamed map open returned false.', null, 'error');
    return ok;
  }

  async function loadBinaryProject(project, ui) {
    showLoading('Converting VMAP…');
    trace('Binary VMAP load requested.', { path: project?.vmapPath });
    try {
      const decoded = await api.loadVmap(project.vmapPath);
      trace('Binary VMAP decode result.', decoded?.ok ? { ok: true, largeMap: decoded.largeMap, decodedBytes: decoded.decodedBytes, meshes: decoded.meshCount, entities: decoded.entityCount, formatVersion: decoded.formatVersion } : decoded, decoded?.ok ? 'normal' : 'error');
      if (cancelled || decoded?.cancelled) return false;
      if (!decoded?.ok) {
        window.log?.(decoded?.error || 'Binary VMAP decode failed', 'error');
        window.toast?.('Could not open VMAP — open Logs for details');
        window.EPH_DIAGNOSTICS?.open?.();
        return false;
      }
      if (decoded.largeMap) return await openStreamed(project, decoded, ui);
      setStage('Opening map…');
      await window.EPH_LARGE_STREAM?.close?.();
      const loaded = await rawLoadProject({ ...project, ephSkipModelWarmup: true }, { ...(ui || {}), vmapText: decoded.text, ephSourceEncoding: 'binary' });
      if (loaded) { S.dirty = false; window.updateTitle?.(); trace('Inline decoded binary VMAP opened.'); }
      else trace('Inline decoded VMAP parser returned false.', null, 'error');
      return loaded;
    } catch (error) {
      trace('Binary VMAP load threw.', error, 'error');
      window.EPH_DIAGNOSTICS?.open?.();
      return false;
    } finally { hideLoading(); }
  }

  async function loadLargeTextProject(project, ui) {
    showLoading('Indexing map…');
    trace('Large KeyValues2 VMAP load requested.', { path: project?.vmapPath });
    try {
      const decoded = await api.openLargeTextMap?.(project.vmapPath);
      trace('Large text index result.', decoded?.ok ? { ok: true, decodedBytes: decoded.decodedBytes, meshes: decoded.meshCount, entities: decoded.entityCount } : decoded, decoded?.ok ? 'normal' : 'error');
      if (cancelled || decoded?.cancelled) return false;
      if (!decoded?.ok) {
        window.log?.(decoded?.error || 'Large VMAP indexing failed', 'error');
        window.toast?.('Could not open VMAP — open Logs for details');
        window.EPH_DIAGNOSTICS?.open?.();
        return false;
      }
      return await openStreamed(project, decoded, ui);
    } catch (error) {
      trace('Large text VMAP load threw.', error, 'error');
      window.EPH_DIAGNOSTICS?.open?.();
      return false;
    } finally { hideLoading(); }
  }

  async function wrappedLoadProject(project, ui) {
    if (!project?.vmapPath) return rawLoadProject(project, ui);
    trace('Inspecting VMAP before open.', { path: project.vmapPath });
    let inspection = null;
    try { inspection = await api.inspectVmap?.(project.vmapPath); }
    catch (error) { trace('Could not inspect VMAP before loading.', error, 'warning'); }
    trace('VMAP inspection.', inspection || { ok: false }, inspection?.ok ? 'normal' : 'warning');
    if (inspection?.ok && inspection.encoding === 'binary') return loadBinaryProject(project, ui);
    if (inspection?.ok && Number(inspection.size) > LARGE_TEXT_BYTES) return loadLargeTextProject(project, ui);
    await window.EPH_LARGE_STREAM?.close?.();
    const result = await rawLoadProject(project, ui);
    trace(`Normal VMAP load ${result ? 'completed' : 'failed'}.`);
    return result;
  }

  wrappedLoadProject.__ephComplexVmapV15 = true;
  window.loadProject = wrappedLoadProject;
  try { loadProject = wrappedLoadProject; } catch {}

  window.EPH_LARGE_MAP_MODE = {
    active: () => Boolean(window.EPH_LARGE_STREAM?.active?.()),
    cancel: () => cancelButton.click(),
  };
})();
