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

  function showLoading(text = 'Loading VMAP…') {
    cancelled = false;
    loading = true;
    title.textContent = text;
    overlay.hidden = false;
  }
  function setStage(text) { if (!overlay.hidden) title.textContent = text || 'Loading VMAP…'; }
  function hideLoading() { loading = false; overlay.hidden = true; }

  cancelButton.onclick = async () => {
    if (!loading) return;
    cancelled = true;
    cancelButton.disabled = true;
    setStage('Cancelling…');
    try { await api.cancelVmapLoad?.(); } catch {}
    hideLoading();
    cancelButton.disabled = false;
    window.log?.('VMAP load cancelled', 'normal');
  };

  api.onVmapLoadProgress?.(event => {
    if (!loading || cancelled) return;
    const label = { convert: 'Converting VMAP…', 'convert-retry': 'Converting VMAP…', index: 'Indexing map…', parse: 'Reading map…', ready: 'Opening map…' }[event?.stage];
    if (label) setStage(label);
  });

  async function openStreamed(project, decoded, ui) {
    const stream = window.EPH_LARGE_STREAM;
    if (!stream?.open) throw new Error('Large-map streaming renderer is unavailable.');
    setStage('Opening map…');
    const ok = await stream.open(rawLoadProject, project, decoded, ui);
    if (ok) window.log?.(`Opened ${project.vmapPath} (${Number(decoded.meshCount || 0).toLocaleString()} meshes, ${Number(decoded.entityCount || 0).toLocaleString()} entities)`, 'normal');
    return ok;
  }

  async function loadBinaryProject(project, ui) {
    showLoading('Converting VMAP…');
    try {
      const decoded = await api.loadVmap(project.vmapPath);
      if (cancelled || decoded?.cancelled) return false;
      if (!decoded?.ok) {
        window.log?.(decoded?.error || 'Binary VMAP decode failed', 'error');
        window.toast?.('Could not open VMAP');
        return false;
      }
      if (decoded.largeMap) return await openStreamed(project, decoded, ui);
      setStage('Opening map…');
      await window.EPH_LARGE_STREAM?.close?.();
      const loaded = await rawLoadProject({ ...project, ephSkipModelWarmup: true }, { ...(ui || {}), vmapText: decoded.text, ephSourceEncoding: 'binary' });
      if (loaded) { S.dirty = false; window.updateTitle?.(); }
      return loaded;
    } finally { hideLoading(); }
  }

  async function loadLargeTextProject(project, ui) {
    showLoading('Indexing map…');
    try {
      const decoded = await api.openLargeTextMap?.(project.vmapPath);
      if (cancelled || decoded?.cancelled) return false;
      if (!decoded?.ok) {
        window.log?.(decoded?.error || 'Large VMAP indexing failed', 'error');
        window.toast?.('Could not open VMAP');
        return false;
      }
      return await openStreamed(project, decoded, ui);
    } finally { hideLoading(); }
  }

  async function wrappedLoadProject(project, ui) {
    if (!project?.vmapPath) return rawLoadProject(project, ui);
    let inspection = null;
    try { inspection = await api.inspectVmap?.(project.vmapPath); }
    catch (error) { console.warn('Could not inspect VMAP before loading', error); }
    if (inspection?.ok && inspection.encoding === 'binary') return loadBinaryProject(project, ui);
    if (inspection?.ok && Number(inspection.size) > LARGE_TEXT_BYTES) return loadLargeTextProject(project, ui);
    await window.EPH_LARGE_STREAM?.close?.();
    return rawLoadProject(project, ui);
  }

  wrappedLoadProject.__ephComplexVmapV15 = true;
  window.loadProject = wrappedLoadProject;
  try { loadProject = wrappedLoadProject; } catch {}

  window.EPH_LARGE_MAP_MODE = {
    active: () => Boolean(window.EPH_LARGE_STREAM?.active?.()),
    cancel: () => cancelButton.click(),
  };
})();
