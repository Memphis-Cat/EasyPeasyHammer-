// byanca
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyPeasyHammer', {
  getStartupState: () => ipcRenderer.invoke('app:get-startup-state'),
  openVmap: () => ipcRenderer.invoke('project:open-vmap'),
  createProject: (name) => ipcRenderer.invoke('project:create', name),
  loadVmap: (vmapPath) => ipcRenderer.invoke('project:load-vmap', vmapPath),
  saveVmap: (vmapPath, text, backup = true) => ipcRenderer.invoke('project:save-vmap', vmapPath, text, backup),
  continueLast: () => ipcRenderer.invoke('project:continue-last'),
  autosave: (snapshot) => ipcRenderer.invoke('project:autosave', snapshot),
  returnHome: (snapshot) => ipcRenderer.invoke('project:return-home', snapshot),
  revealProject: (projectFolder) => ipcRenderer.invoke('project:reveal', projectFolder),
  clearLastSession: () => ipcRenderer.invoke('project:clear-last-session'),
  assetStatus: () => ipcRenderer.invoke('assets:status'),
  detectCs2: () => ipcRenderer.invoke('assets:detect'),
  chooseCs2Folder: () => ipcRenderer.invoke('assets:choose-cs2-folder'),
  searchAssets: (kind, query = '', limit = 200) => ipcRenderer.invoke('assets:search', kind, query, limit),
  materialPreview: (resourcePath) => ipcRenderer.invoke('assets:material-preview', resourcePath),
  modelPreview: (resourcePath) => ipcRenderer.invoke('assets:model-preview', resourcePath),
  openWorkshopTools: () => ipcRenderer.invoke('tools:open-workshop')
});

window.addEventListener('DOMContentLoaded', () => {
  const startupStyle = document.createElement('link');
  startupStyle.rel = 'stylesheet';
  startupStyle.href = 'startup.css';
  document.head.appendChild(startupStyle);

  const themeScript = document.createElement('script');
  themeScript.src = 'theme.js';
  document.head.appendChild(themeScript);

  const modal = document.getElementById('newProjectModal');
  const input = document.getElementById('newProjectName');
  if (!modal || !input) return;

  input.disabled = false;
  input.readOnly = false;
  input.tabIndex = 0;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const focusProjectName = () => {
    if (modal.classList.contains('hidden')) return;
    input.disabled = false;
    input.readOnly = false;
    input.focus({ preventScroll: true });
  };

  const observer = new MutationObserver(() => {
    if (!modal.classList.contains('hidden')) {
      requestAnimationFrame(() => {
        focusProjectName();
        setTimeout(focusProjectName, 25);
      });
    }
  });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });

  input.addEventListener('pointerdown', () => requestAnimationFrame(focusProjectName));
  input.addEventListener('click', focusProjectName);

  document.addEventListener('keydown', event => {
    if (modal.classList.contains('hidden')) return;

    if (event.key === 'Escape') {
      modal.classList.add('hidden');
      event.preventDefault();
      return;
    }

    if (document.activeElement === input) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key.length === 1) {
      focusProjectName();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.setRangeText(event.key, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      event.preventDefault();
    } else if (event.key === 'Backspace') {
      focusProjectName();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      if (start !== end) input.setRangeText('', start, end, 'end');
      else if (start > 0) input.setRangeText('', start - 1, start, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      event.preventDefault();
    }
  }, true);
});
