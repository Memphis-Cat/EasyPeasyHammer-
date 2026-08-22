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

  form.addEventListener('keydown', event => {
    event.stopPropagation();
  });
  form.addEventListener('keyup', event => {
    event.stopPropagation();
  });

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

if (!document.querySelector('script[data-eph-interaction-pass]')) {
  const interactionPass = document.createElement('script');
  interactionPass.src = 'interaction-pass.js';
  interactionPass.dataset.ephInteractionPass = '1';
  document.body.appendChild(interactionPass);
}
