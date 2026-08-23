// byanca
(() => {
  'use strict';

  if (window.__ephSaveGuardV10 || typeof window.save !== 'function') return;
  window.__ephSaveGuardV10 = true;

  const rawSave = window.save;
  const rawOpenHammer = typeof window.openHammer === 'function' ? window.openHammer : null;
  const $ = id => document.getElementById(id);
  let saving = false;

  function report(error, action = 'Save') {
    const message = error?.message || String(error || 'Unknown VMAP compatibility error.');
    const concise = message.length > 180 ? `${message.slice(0, 177)}...` : message;
    try { window.log?.(`${action} blocked: ${message}`, 'warning'); } catch {}
    try { window.toast?.(`${action} blocked — ${concise}`); } catch {}
    const status = $('autosaveStatus');
    if (status) {
      status.textContent = `${action} blocked: ${concise}`;
      status.title = message;
    }
    console.error(`EasyPeasyHammer ${action.toLowerCase()} blocked`, error);
  }

  async function guardedSave(show = true) {
    if (saving) return false;
    saving = true;
    const status = $('autosaveStatus');
    if (status) {
      status.textContent = 'Saving VMAP...';
      status.title = 'Running Hammer compatibility checks before writing the VMAP.';
    }
    try {
      await rawSave(show);
      const saved = /^Saved\s/i.test(status?.textContent || '');
      if (!saved) {
        report(new Error('The VMAP writer rejected the file or did not complete successfully.'), 'Save');
        return false;
      }
      if (status) status.title = '';
      return true;
    } catch (error) {
      report(error, 'Save');
      return false;
    } finally {
      saving = false;
    }
  }

  async function guardedOpenHammer() {
    const ok = await guardedSave(false);
    if (!ok) {
      try { window.toast?.('Hammer was not opened because the VMAP did not save safely.'); } catch {}
      return false;
    }
    try {
      const result = await window.easyPeasyHammer.openWorkshopTools();
      if (result?.ok) {
        try { window.toast?.('CS2 Workshop Tools launched'); } catch {}
        try { window.log?.('Launched CS2 Workshop Tools. Open the saved VMAP in Hammer.', 'success'); } catch {}
        return true;
      }
      const message = result?.error || 'Workshop Tools could not be launched';
      try { window.toast?.(message); } catch {}
      try { window.log?.(message, 'warning'); } catch {}
      return false;
    } catch (error) {
      report(error, 'Open in Hammer');
      return false;
    }
  }

  window.save = guardedSave;
  if (rawOpenHammer) window.openHammer = guardedOpenHammer;

  for (const id of ['toolbarSave', 'toolbarSaveAll', 'exportButton']) {
    const button = $(id);
    if (button) button.onclick = () => guardedSave(true);
  }
  const fileSave = document.querySelector('.dropdown-menu [data-action="save"]');
  if (fileSave) fileSave.onclick = event => {
    event.preventDefault();
    try { window.closeMenus?.(); } catch {}
    guardedSave(true);
  };
  const hammer = $('hammerButton');
  if (hammer) hammer.onclick = guardedOpenHammer;
  for (const button of document.querySelectorAll('.dropdown-menu [data-action="build-placeholder"]')) button.onclick = guardedOpenHammer;

  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    guardedSave(true);
  }, true);
})();
