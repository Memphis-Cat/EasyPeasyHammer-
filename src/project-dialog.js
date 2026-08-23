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

  const close = () => {
    setError('');
    if (dialog.open) dialog.close();
  };

  const open = () => {
    if (dialog.open) return;
    input.value = '';
    input.disabled = false;
    input.readOnly = false;
    setError('');
    dialog.showModal();
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
  };

  const createProject = async () => {
    const name = input.value.trim();
    if (!name) {
      setError('Enter a project name.');
      input.focus({ preventScroll: true });
      return;
    }

    setError('');
    confirm.disabled = true;
    cancel.disabled = true;

    try {
      const result = await api.createProject(name);
      if (!result) {
        setError('Could not create the project.');
        return;
      }

      const project = result.project || result;
      const doc = VMAP.createEmptyDocument();
      const validation = VMAP.validate(doc);
      if (!validation.ok) {
        setError(`Could not create a valid Hammer VMAP: ${validation.errors.join(' ')}`);
        return;
      }
      const write = await api.saveVmap(project.vmapPath, VMAP.stringify(doc), false);
      if (!write?.ok) {
        setError(write?.error || 'Could not create the VMAP file.');
        return;
      }

      close();
      if (typeof window.loadProject === 'function') {
        const loaded = await window.loadProject(project, null);
        if (!loaded) setError('The project was created, but could not be opened.');
      } else {
        location.reload();
      }
    } catch (e) {
      setError(e?.message || 'Could not create the project.');
    } finally {
      confirm.disabled = false;
      cancel.disabled = false;
    }
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    createProject();
  });

  form.addEventListener('keydown', event => event.stopPropagation());
  form.addEventListener('keyup', event => event.stopPropagation());

  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });

  document.getElementById('createProjectButton').onclick = open;
  const toolbarNew = document.getElementById('toolbarNew');
  if (toolbarNew) toolbarNew.onclick = open;
  const fileNew = document.querySelector('.dropdown-menu [data-action="new-project"]');
  if (fileNew) fileNew.onclick = open;
})();

function loadPass(src, marker) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-${marker}]`);
    if (existing) {
      if (existing.dataset.loaded === '1') resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.dataset[marker] = '1';
    script.addEventListener('load', () => { script.dataset.loaded = '1'; resolve(); }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.body.appendChild(script);
  });
}

async function safeLoadPass(src, marker) {
  try {
    await loadPass(src, marker);
    return true;
  } catch (error) {
    console.error(`EasyPeasyHammer pass failed: ${src}`, error);
    return false;
  }
}

async function ensureViewportBundle() {
  if (window.EPH3D) return true;

  await new Promise(resolve => setTimeout(resolve, 250));
  if (window.EPH3D) return true;

  const loaded = await safeLoadPass('bundled/viewport3d.bundle.js', 'ephViewport3dBundle');
  if (!loaded || !window.EPH3D) {
    console.error('EasyPeasyHammer renderer did not initialize.');
    return false;
  }
  return true;
}

(async () => {
  await safeLoadPass('vmap-compat-v9.js', 'ephVmapCompatV9');
  await safeLoadPass('interaction-pass.js', 'ephInteractionPass');
  await ensureViewportBundle();
  await safeLoadPass('bundled/advanced-viewport.bundle.js', 'ephAdvancedViewportBundle');
  await safeLoadPass('bundled/hammer-fidelity.bundle.js', 'ephHammerFidelityBundle');
  await safeLoadPass('bundled/fidelity-v2.bundle.js', 'ephFidelityV2Bundle');
  await safeLoadPass('bundled/texture-projection-v4.bundle.js', 'ephTextureProjectionV4Bundle');
  await safeLoadPass('load-acceleration.js', 'ephLoadAcceleration');
  await safeLoadPass('default-part.js', 'ephDefaultPart');
  await safeLoadPass('hammer-fidelity-ui.js', 'ephHammerFidelityUi');
  await safeLoadPass('advanced-ui.js', 'ephAdvancedUi');
  await safeLoadPass('pre-audit-v8.js', 'ephPreAuditV8');
  await safeLoadPass('bundled/editor-tools-v6.bundle.js', 'ephEditorToolsV6Bundle');
  await safeLoadPass('bundled/editor-ux-v7.bundle.js', 'ephEditorUxV7Bundle');
  await safeLoadPass('editor-ux-bindings-v7.js', 'ephEditorUxBindingsV7');
  await safeLoadPass('special-mesh-duplicate-v6.js', 'ephSpecialMeshDuplicateV6');
  await safeLoadPass('phase4-project-sync.js', 'ephPhase4ProjectSync');
  await safeLoadPass('phase4-copy.js', 'ephPhase4Copy');
  await safeLoadPass('bundled/audit-fixes-v8.bundle.js', 'ephAuditFixesV8Bundle');
  await safeLoadPass('collab-runtime.js', 'ephCollabRuntime');
  await safeLoadPass('collab-terrain-live-v8.js', 'ephCollabTerrainLiveV8');
  await safeLoadPass('collab-camera-v6.js', 'ephCollabCameraV6');
  await safeLoadPass('bundled/collab-visuals.bundle.js', 'ephCollabVisualsBundle');
  await safeLoadPass('bell1.js', 'ephBell1');
  await safeLoadPass('collab-ui.js', 'ephCollabUi');
})();
