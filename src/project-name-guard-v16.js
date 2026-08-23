// byanca
(() => {
  'use strict';
  if (window.__ephProjectNameGuardV16) return;
  window.__ephProjectNameGuardV16 = true;

  const api = window.easyPeasyHammer;
  const VMAP = window.EPH_VMAP;
  const form = document.getElementById('newProjectForm');
  if (!api?.checkProjectName || !VMAP || !form) return;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const dialog = document.getElementById('newProjectModal');
    const input = document.getElementById('newProjectName');
    const error = document.getElementById('newProjectError');
    const confirm = document.getElementById('confirmCreateButton');
    const cancel = document.getElementById('cancelCreateButton');
    const setError = message => { if (error) { error.textContent = message || ''; error.classList.toggle('visible', Boolean(message)); } };
    const name = input?.value?.trim() || '';
    if (!name) { setError('Enter a project name.'); input?.focus(); return; }

    confirm.disabled = true;
    cancel.disabled = true;
    try {
      const availability = await api.checkProjectName(name);
      if (!availability?.available) { setError(availability?.error || `A map named “${name}” already exists.`); return; }
      setError('');
      const result = await api.createProject(name);
      if (!result || result.ok === false) { setError(result?.error || 'Could not create the project.'); return; }
      const project = result.project || result;
      const doc = VMAP.createEmptyDocument();
      const validation = VMAP.validate(doc);
      if (!validation.ok) { setError(`Could not create a valid Hammer VMAP: ${validation.errors.join(' ')}`); return; }
      const write = await api.saveVmap(project.vmapPath, VMAP.stringify(doc), false);
      if (!write?.ok) { setError(write?.error || 'Could not create the VMAP file.'); return; }
      if (dialog?.open) dialog.close();
      const loaded = await window.loadProject?.(project, null);
      if (!loaded) setError('The project was created, but could not be opened.');
    } catch (e) {
      setError(e?.message || 'Could not create the project.');
    } finally {
      confirm.disabled = false;
      cancel.disabled = false;
    }
  }, true);
})();
