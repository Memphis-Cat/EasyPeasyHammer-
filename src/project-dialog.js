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

function loadPass(src, marker, module = false) {
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
    if (module) script.type = 'module';
    script.src = src;
    script.dataset[marker] = '1';
    script.addEventListener('load', () => { script.dataset.loaded = '1'; resolve(); }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.body.appendChild(script);
  });
}

(async () => {
  try {
    await loadPass('interaction-pass.js', 'ephInteractionPass');
    await loadPass('advanced-viewport.js', 'ephAdvancedViewport', true);
    await loadPass('hammer-fidelity.js', 'ephHammerFidelity', true);
    await loadPass('fidelity-v2.js', 'ephFidelityV2', true);
    await loadPass('texture-projection-v4.js', 'ephTextureProjectionV4', true);
    await loadPass('load-acceleration.js', 'ephLoadAcceleration');
    await loadPass('default-part.js', 'ephDefaultPart');
    await loadPass('hammer-fidelity-ui.js', 'ephHammerFidelityUi');
    await loadPass('advanced-ui.js', 'ephAdvancedUi');
    await loadPass('phase4-copy.js', 'ephPhase4Copy');
    await loadPass('collab-runtime.js', 'ephCollabRuntime');
    await loadPass('collab-visuals.js', 'ephCollabVisuals', true);
    await loadPass('bell1.js', 'ephBell1');
    await loadPass('collab-ui.js', 'ephCollabUi');
  } catch (error) {
    console.error('EasyPeasyHammer editor pass failed to load:', error);
  }
})();
