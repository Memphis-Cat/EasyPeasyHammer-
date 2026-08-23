// byanca
(() => {
  'use strict';

  if (window.__ephComplexVmapV15 || typeof window.loadProject !== 'function') return;
  window.__ephComplexVmapV15 = true;

  const api = window.easyPeasyHammer;
  const VMAP = window.EPH_VMAP;
  const rawLoadProject = window.loadProject;

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
      <span id="ephComplexVmapLoadingDetail">Preparing map data.</span>
    </div>`;
  document.body.appendChild(overlay);

  const loadingTitle = overlay.querySelector('#ephComplexVmapLoadingTitle');
  const loadingDetail = overlay.querySelector('#ephComplexVmapLoadingDetail');

  function showLoading(title, detail) {
    loadingTitle.textContent = title || 'Loading VMAP…';
    loadingDetail.textContent = detail || 'Preparing map data.';
    overlay.hidden = false;
  }

  function hideLoading() {
    overlay.hidden = true;
  }

  function compatibilityText(result) {
    const doc = VMAP.createEmptyDocument();
    for (const entity of result.entities || []) {
      try {
        const props = { ...(entity.entityProperties || {}) };
        VMAP.addEntity(doc, {
          className: entity.className || props.classname || 'info_target',
          name: entity.name && entity.name !== entity.className ? entity.name : (props.targetname || ''),
          model: entity.model || props.model || '',
          position: Array.isArray(entity.position) ? entity.position : [0, 0, 0],
          rotation: Array.isArray(entity.rotation) ? entity.rotation : [0, 0, 0],
          scale: Array.isArray(entity.scale) ? entity.scale : [1, 1, 1],
          visible: entity.visible !== false,
          collision: String(props.solid ?? '6') !== '0',
          entityProperties: props,
        });
      } catch (error) {
        console.warn('EasyPeasyHammer skipped a compatibility entity', entity?.className, error);
      }
    }
    return VMAP.stringify(doc);
  }

  function clearCompatibilityUi() {
    document.getElementById('ephLargeMapBanner')?.remove();
    document.getElementById('editorScreen')?.classList.remove('eph-large-map-mode');
    for (const id of ['toolbarSave', 'toolbarSaveAll', 'exportButton']) {
      const button = document.getElementById(id);
      if (!button) continue;
      if (button.dataset.ephLargeMapDisabled === '1') {
        button.disabled = false;
        button.removeAttribute('aria-disabled');
        button.title = button.dataset.ephPreviousTitle || button.title || '';
        delete button.dataset.ephLargeMapDisabled;
        delete button.dataset.ephPreviousTitle;
      }
    }
  }

  function applyCompatibilityUi(project) {
    if (!project?.ephReadOnlySource) {
      clearCompatibilityUi();
      return;
    }

    const stats = project.ephLargeMapStats || {};
    const editor = document.getElementById('editorScreen');
    const viewport = document.getElementById('viewport');
    editor?.classList.add('eph-large-map-mode');

    let banner = document.getElementById('ephLargeMapBanner');
    if (!banner && viewport) {
      banner = document.createElement('div');
      banner.id = 'ephLargeMapBanner';
      banner.className = 'eph-large-map-banner';
      viewport.appendChild(banner);
    }
    if (banner) {
      const entityText = Number.isFinite(stats.entityCount) ? `${stats.entityCount.toLocaleString()} entities loaded` : 'entities loaded';
      const meshText = Number.isFinite(stats.meshCount) ? `${stats.meshCount.toLocaleString()} heavy meshes deferred` : 'heavy geometry deferred';
      banner.innerHTML = `<strong>Large Map Compatibility</strong><span>${entityText} · ${meshText} · source VMAP is read-only here</span>`;
    }

    for (const id of ['toolbarSave', 'toolbarSaveAll', 'exportButton']) {
      const button = document.getElementById(id);
      if (!button || button.dataset.ephLargeMapDisabled === '1') continue;
      button.dataset.ephLargeMapDisabled = '1';
      button.dataset.ephPreviousTitle = button.title || '';
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.title = 'Large Map Compatibility Mode is read-only so the original VMAP cannot be damaged.';
    }

    const mapStatus = document.getElementById('mapStatus');
    if (mapStatus) mapStatus.textContent = `Map: ${project.name || 'VMAP'} · compatibility preview`;
  }

  async function loadBinaryProject(project, ui, inspection) {
    const sizeMb = inspection?.size ? (inspection.size / 1024 / 1024).toFixed(1) : null;
    showLoading(
      'Converting binary Hammer VMAP…',
      sizeMb ? `${sizeMb} MB source. The app stays responsive while CS2 dmxconvert runs.` : 'The app stays responsive while CS2 dmxconvert runs.'
    );

    let decoded;
    try {
      decoded = await api.loadVmap(project.vmapPath);
    } finally {
      hideLoading();
    }

    if (!decoded?.ok) {
      window.toast?.('Could not decode this VMAP');
      window.log?.(decoded?.error || 'Binary VMAP decode failed', 'warning');
      return false;
    }

    if (decoded.largeCompatibility) {
      showLoading('Preparing large-map compatibility preview…', 'Loading entities while heavy static mesh geometry stays deferred.');
      try {
        const text = compatibilityText(decoded);
        const compatProject = {
          ...project,
          ephReadOnlySource: true,
          ephLargeMapCompatibility: true,
          ephSourceVmapPath: project.vmapPath,
          ephLargeMapStats: {
            sourceBytes: decoded.size,
            decodedBytes: decoded.decodedBytes,
            entityCount: decoded.entityCount,
            entityLimitReached: decoded.entityLimitReached,
            meshCount: decoded.meshCount,
            classCounts: decoded.classCounts || [],
          },
        };
        const compatUi = {
          ...(ui || {}),
          vmapText: text,
          ephLargeMapStats: compatProject.ephLargeMapStats,
          ephCompatibilityWarning: decoded.warning || '',
        };
        const loaded = await rawLoadProject(compatProject, compatUi);
        if (!loaded) return false;
        S.project = compatProject;
        S.dirty = false;
        window.updateTitle?.();
        applyCompatibilityUi(compatProject);
        window.log?.(decoded.warning || 'Loaded Large Map Compatibility Mode.', 'warning');
        if (decoded.entityLimitReached) window.log?.('Entity preview was capped to keep the renderer responsive.', 'warning');
        window.toast?.(`Large map loaded: ${Number(decoded.entityCount || 0).toLocaleString()} entities; heavy geometry deferred`);
        return true;
      } finally {
        hideLoading();
      }
    }

    const loaded = await rawLoadProject(project, { ...(ui || {}), vmapText: decoded.text, ephSourceEncoding: 'binary' });
    if (loaded) {
      S.dirty = false;
      window.updateTitle?.();
      clearCompatibilityUi();
    }
    return loaded;
  }

  async function wrappedLoadProject(project, ui) {
    if (!project?.vmapPath) return rawLoadProject(project, ui);

    if (ui?.vmapText) {
      const loaded = await rawLoadProject(project, ui);
      if (loaded) applyCompatibilityUi(project);
      return loaded;
    }

    let inspection = null;
    try { inspection = await api.inspectVmap?.(project.vmapPath); } catch {}
    if (inspection?.ok && inspection.encoding === 'binary') return loadBinaryProject(project, ui, inspection);

    const loaded = await rawLoadProject(project, ui);
    if (loaded) clearCompatibilityUi();
    return loaded;
  }

  wrappedLoadProject.__ephComplexVmapV15 = true;
  window.loadProject = wrappedLoadProject;
  try { loadProject = wrappedLoadProject; } catch {}

  window.EPH_LARGE_MAP_MODE = {
    active: () => Boolean(S.project?.ephReadOnlySource),
    stats: () => S.project?.ephLargeMapStats || null,
  };
})();
