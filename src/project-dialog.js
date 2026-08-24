// byanca
(() => {
  const oldModal = document.getElementById('newProjectModal');
  if (!oldModal) return;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'project-dialog.css';
  document.head.appendChild(style);

  const dialog = document.createElement('dialog');
  dialog.id = 'newProjectModal';
  dialog.className = 'project-native-dialog';
  dialog.innerHTML = `
    <form id="newProjectForm" class="modal-card project-dialog-card" novalidate>
      <h2>Create new project</h2>
      <label for="newProjectName">Project name</label>
      <input id="newProjectName" name="projectName" type="text" maxlength="80" autocomplete="off" spellcheck="false" placeholder="awp_my_map" />
      <div id="newProjectError" class="project-dialog-error" role="alert" aria-live="polite"></div>
      <p>The project is created immediately in <strong>Projects</strong> beside EasyPeasyHammer.</p>
      <div class="modal-actions">
        <button id="cancelCreateButton" type="button" class="secondary-button">Cancel</button>
        <button id="confirmCreateButton" type="submit" class="primary-button">Create project</button>
      </div>
    </form>`;
  oldModal.replaceWith(dialog);

  const form = dialog.querySelector('#newProjectForm');
  const input = dialog.querySelector('#newProjectName');
  const error = dialog.querySelector('#newProjectError');
  const cancel = dialog.querySelector('#cancelCreateButton');
  const confirm = dialog.querySelector('#confirmCreateButton');
  const api = window.easyPeasyHammer;
  const VMAP = window.EPH_VMAP;

  const setError = message => {
    error.textContent = message || '';
    error.classList.toggle('visible', Boolean(message));
  };
  const close = () => { setError(''); if (dialog.open) dialog.close(); };
  const open = () => {
    if (dialog.open) return;
    input.value = '';
    input.disabled = false;
    input.readOnly = false;
    setError('');
    dialog.showModal();
    requestAnimationFrame(() => { input.focus({ preventScroll: true }); input.select(); });
  };

  async function waitForRuntime() {
    try { await window.EPH_RUNTIME_READY; } catch {}
  }

  const createProject = async () => {
    const name = input.value.trim();
    if (!name) { setError('Enter a project name.'); input.focus({ preventScroll: true }); return; }
    setError(''); confirm.disabled = true; cancel.disabled = true;
    try {
      await waitForRuntime();
      const result = await api.createProject(name);
      if (!result) { setError('Could not create the project.'); return; }
      const project = result.project || result;
      const doc = VMAP.createEmptyDocument();
      const validation = VMAP.validate(doc);
      if (!validation.ok) { setError(`Could not create a valid Hammer VMAP: ${validation.errors.join(' ')}`); return; }
      const write = await api.saveVmap(project.vmapPath, VMAP.stringify(doc), false);
      if (!write?.ok) { setError(write?.error || 'Could not create the VMAP file.'); return; }
      close();
      if (typeof window.loadProject === 'function') {
        const loaded = await window.loadProject(project, null);
        if (!loaded) setError('The project was created, but could not be opened.');
      } else location.reload();
    } catch (e) {
      setError(e?.message || 'Could not create the project.');
    } finally {
      confirm.disabled = false; cancel.disabled = false;
    }
  };

  form.addEventListener('submit', event => { event.preventDefault(); createProject(); });
  form.addEventListener('keydown', event => event.stopPropagation());
  form.addEventListener('keyup', event => event.stopPropagation());
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.getElementById('createProjectButton').onclick = open;
  document.getElementById('toolbarNew')?.addEventListener('click', open);
  const fileNew = document.querySelector('.dropdown-menu [data-action="new-project"]');
  if (fileNew) fileNew.onclick = open;
})();

function loadPass(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(script => script.dataset.ephPassSrc === src || script.getAttribute('src')?.endsWith(`/${src}`) || script.getAttribute('src') === src);
    if (existing) {
      if (existing.dataset.ephLoaded === '1' || existing.readyState === 'complete') return resolve(true);
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.ephPassSrc = src;
    script.addEventListener('load', () => { script.dataset.ephLoaded = '1'; resolve(true); }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.body.appendChild(script);
  });
}

async function safeLoadPass(src) {
  try { return await loadPass(src); }
  catch (error) { console.error(`EasyPeasyHammer pass failed: ${src}`, error); return false; }
}

async function ensureViewportBundle() {
  if (window.EPH3D) return true;
  const loaded = await safeLoadPass('bundled/viewport3d.bundle.js');
  if (!loaded || !window.EPH3D) {
    console.error('EasyPeasyHammer renderer did not initialize.');
    return false;
  }
  return true;
}

const BASE_PASSES = [
  'vmap-compat-v9.js',
  'vmap-helper-compat-v9.js',
  'interaction-pass.js',
  'bundled/advanced-viewport.bundle.js',
  'bundled/hammer-fidelity.bundle.js',
  'bundled/fidelity-v2.bundle.js',
  'bundled/texture-projection-v4.bundle.js',
  'load-acceleration.js',
  'default-part.js',
  'hammer-fidelity-ui.js',
  'advanced-ui.js',
  'pre-audit-v8.js',
  'bundled/editor-tools-v6.bundle.js',
  'bundled/editor-ux-v7.bundle.js',
  'editor-ux-bindings-v7.js',
  'special-mesh-duplicate-v6.js',
  'phase4-project-sync.js',
  'phase4-copy.js',
  'bundled/audit-fixes-v8.bundle.js',
  'collab-runtime.js',
  'collab-terrain-live-v8.js',
  'collab-camera-v6.js',
  'vmap-finalize-v10.js',
  'bundled/collab-visuals.bundle.js',
  'bell1.js',
  'collab-ui.js',
  'save-guard-v10.js',
  'vertex-paint-fix-v14.js',
  'entity-compat-v15.js',
  'entity-mesh-compat-v15.js',
  'fgd-catalog-v15.js',
  'complex-vmap-v15.js',
  'layout-safe-v14.js'
];

const LATE_PASSES = [
  'vmap-import-fidelity-v27.js',
  'large-map-stream-v21.js',
  'large-map-spatial-v19.js',
  'visual-clean-v16.js',
  'project-name-guard-v16.js',
  'diagnostics-v16.js',
  'diagnostics-v18.js',
  'entity-fidelity-v17.js',
  'fgd-editor-model-guard-v18.js',
  'entity-fidelity-v18.js',
  'asset-manager-v24.js',
  'map-local-assets-v19.js',
  'map-local-fast-v21.js',
  'render-performance-v20.js',
  'entity-runtime-v21.js',
  'mesh-render-fast-v27.js',
  'source2-coordinates-v23.js',
  'scale-tool-v21.js',
  'scale-legacy-disable-v21.js',
  'transform-precision-v23.js',
  'large-map-bootstrap-v21.js',
  'collab-chat-v22.js',
  'multi-select-v22.js',
  'multi-select-coordinates-v23.js',
  'collab-local-view-v23.js',
  'local-history-v22.js',
  'history-bindings-v22.js',
  'history-hierarchy-repair-v26.js',
  'negative-brush-v22.js',
  'negative-brush-wall-preserve-v23.js',
  'negative-brush-safety-v22.js',
  'mesh-topology-repair-v36.js',
  'properties-scroll-v23.js',
  'solid-entity-runtime-v24.js',
  'collision-export-v25.js',
  'large-map-ui-fast-v27.js',
  'editor-stability-v28.js',
  'close-save-v28.js',
  'solid-entity-unified-v30.js',
  'viewport-layout-integrity-v35.js',
  'render-core-integrity-v34.js',
  'particle-system-unified-v26.js',
  'mesh-entity-transform-v31.js',
  'mesh-entity-collision-ownership-v32.js',
  'entity-transform-persistence-v33.js',
  'entity-model-basis-v41.js',
  'hammer-material-resolver-v42.js',
  'hammer-fgd-visuals-v42.js',
  'selection-surface-move-v39.js',
  'fgd-reference-picker-v43.js',
  'select-click-capture-v40.js',
  'hammer-placement-gizmo-v41.js',
  'render-frame-watchdog-v36.js',
  'startup-recents-v14.js'
];

document.documentElement.dataset.ephRuntimeReady = '0';
window.EPH_RUNTIME_READY = (async () => {
  await ensureViewportBundle();
  for (const src of BASE_PASSES) await safeLoadPass(src);
  for (const src of LATE_PASSES) await safeLoadPass(src);
  document.documentElement.dataset.ephRuntimeReady = '1';
  window.dispatchEvent(new CustomEvent('eph-runtime-ready'));
  console.info('[Runtime] Deterministic renderer pass sequence completed.');
  return true;
})();
