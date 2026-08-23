// byanca
(() => {
  'use strict';

  if (window.__ephWorkspaceV14) return;
  window.__ephWorkspaceV14 = true;

  const api = window.easyPeasyHammer;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'workspace-v14.css';
  document.head.appendChild(style);

  const rawLoadProject = typeof window.loadProject === 'function' ? window.loadProject : null;
  const rawExitMap = typeof window.exitMap === 'function' ? window.exitMap : null;
  const rawUpdateTitle = typeof window.updateTitle === 'function' ? window.updateTitle : null;
  if (!rawLoadProject) return;

  const tabs = [];
  let activeTabId = null;
  let switching = false;
  let tabSequence = 0;

  const clone = value => {
    try { return structuredClone(value); } catch { return value; }
  };
  const projectKey = project => String(project?.vmapPath || project?.id || project?.name || '').toLowerCase();
  const activeTab = () => tabs.find(tab => tab.id === activeTabId) || null;
  const tabForProject = project => tabs.find(tab => tab.key === projectKey(project)) || null;

  const strip = document.createElement('div');
  strip.id = 'ephMapTabs';
  strip.className = 'eph-map-tabs';
  document.querySelector('.app-header')?.appendChild(strip);

  function captureCurrent(tab = activeTab()) {
    if (!tab || !S.project || !S.doc || tab.key !== projectKey(S.project)) return false;
    try {
      tab.project = clone(S.project);
      tab.ui = typeof uiSnapshot === 'function' ? uiSnapshot() : null;
      tab.saveText = typeof saveText === 'function' ? saveText() : tab.ui?.vmapText || '';
      tab.dirty = Boolean(S.dirty);
      tab.undo = clone(S.undo || []);
      tab.redo = clone(S.redo || []);
      tab.logs = clone(S.logs || []);
      tab.lastAutosave = Number(S.lastAutosave) || 0;
      return true;
    } catch (error) {
      console.error('EasyPeasyHammer could not snapshot map tab', error);
      return false;
    }
  }

  function registerCurrent() {
    if (!S.project || !S.doc) return null;
    const key = projectKey(S.project);
    let tab = tabs.find(item => item.key === key);
    if (!tab) {
      tab = { id: `map-${++tabSequence}`, key, project: clone(S.project), ui: null, saveText: '', dirty: Boolean(S.dirty), undo: [], redo: [], logs: [] };
      tabs.push(tab);
    }
    activeTabId = tab.id;
    captureCurrent(tab);
    renderTabs();
    return tab;
  }

  function renderTabs() {
    if (!strip) return;
    strip.replaceChildren();
    for (const tab of tabs) {
      const item = document.createElement('div');
      item.className = `eph-map-tab${tab.id === activeTabId ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`;
      item.dataset.tabId = tab.id;
      item.title = tab.project?.vmapPath || tab.project?.name || 'Map';
      item.tabIndex = -1;

      const name = document.createElement('span');
      name.className = 'eph-map-tab-name';
      name.textContent = `${tab.project?.name || 'Untitled'}.vmap`;
      const close = document.createElement('span');
      close.className = 'eph-map-tab-close';
      close.textContent = '×';
      close.title = 'Close map';
      close.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closeTab(tab.id);
      });
      item.append(name, close);
      item.addEventListener('click', () => switchTab(tab.id));
      strip.appendChild(item);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'eph-map-tab-add';
    add.title = 'Open another VMAP';
    add.textContent = '+';
    add.onclick = openAdditionalMap;
    strip.appendChild(add);
  }

  async function rememberTab(tab) {
    if (!tab?.project || !tab.ui) return;
    try { await api.autosave?.({ project: tab.project, uiState: tab.ui }); } catch {}
  }

  async function openAdditionalMap() {
    const result = await api.openVmap?.();
    if (!result) return;
    const project = result.project || result;
    const loaded = await window.loadProject(project, result.uiState || null);
    if (loaded) window.log?.(`Opened ${project.vmapPath}`, 'success');
  }

  async function wrappedLoadProject(project, ui) {
    const incomingKey = projectKey(project);
    const current = activeTab();
    if (!switching && current && current.key !== incomingKey) {
      captureCurrent(current);
      rememberTab(current);
    }

    const loaded = await rawLoadProject(project, ui);
    if (!loaded) return loaded;

    let tab = tabs.find(item => item.key === incomingKey);
    if (!tab) {
      tab = { id: `map-${++tabSequence}`, key: incomingKey, project: clone(S.project), ui: null, saveText: '', dirty: Boolean(S.dirty), undo: [], redo: [], logs: [] };
      tabs.push(tab);
    }
    activeTabId = tab.id;
    tab.project = clone(S.project);
    captureCurrent(tab);
    renderTabs();
    return loaded;
  }

  window.loadProject = wrappedLoadProject;
  try { loadProject = wrappedLoadProject; } catch {}

  async function switchTab(tabId, options = {}) {
    const target = tabs.find(tab => tab.id === tabId);
    if (!target || target.id === activeTabId || switching) return;
    const previous = activeTab();
    if (!options.skipCapture && previous) {
      captureCurrent(previous);
      await rememberTab(previous);
    }

    switching = true;
    try {
      const loaded = await rawLoadProject(target.project, target.ui);
      if (!loaded) {
        window.toast?.(`Could not open ${target.project?.name || 'map'}`);
        return;
      }
      activeTabId = target.id;
      S.dirty = Boolean(target.dirty);
      S.undo = clone(target.undo || []);
      S.redo = clone(target.redo || []);
      S.logs = clone(target.logs || []);
      S.lastAutosave = Number(target.lastAutosave) || S.lastAutosave;
      rawUpdateTitle?.();
      if (typeof renderBottom === 'function') renderBottom();
      renderTabs();
      requestAnimationFrame(() => S.viewport?.updateSelectionBox?.());
    } finally {
      switching = false;
    }
  }

  async function saveBackgroundTab(tab) {
    if (!tab?.dirty) return true;
    if (!tab.saveText) return false;
    try {
      const result = await api.saveVmap?.(tab.project.vmapPath, tab.saveText, true);
      if (!result?.ok) {
        window.log?.(`Save failed for ${tab.project?.name}: ${result?.error || 'unknown error'}`, 'warning');
        return false;
      }
      tab.dirty = false;
      await rememberTab(tab);
      return true;
    } catch (error) {
      window.log?.(`Save failed for ${tab.project?.name}: ${error.message}`, 'warning');
      return false;
    }
  }

  async function saveTab(tab) {
    if (!tab) return true;
    if (tab.id === activeTabId) {
      const result = await window.save?.(false);
      captureCurrent(tab);
      return result !== false && !S.dirty;
    }
    return saveBackgroundTab(tab);
  }

  async function saveAllTabs() {
    const current = activeTab();
    if (current) captureCurrent(current);
    let saved = 0;
    let failed = 0;

    for (const tab of tabs) {
      if (!tab.dirty) continue;
      const ok = await saveTab(tab);
      if (ok) saved++; else failed++;
    }
    renderTabs();
    if (failed) window.toast?.(`Saved ${saved} map${saved === 1 ? '' : 's'}; ${failed} failed`);
    else window.toast?.(saved ? `Saved ${saved} map${saved === 1 ? '' : 's'}` : 'All maps already saved');
  }

  async function closeTab(tabId) {
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index < 0) return;
    const tab = tabs[index];
    if (tab.id === activeTabId) captureCurrent(tab);
    if (tab.dirty && !(await saveTab(tab))) {
      window.toast?.(`Could not close ${tab.project?.name || 'map'} because it did not save`);
      return;
    }

    const wasActive = tab.id === activeTabId;
    tabs.splice(index, 1);
    if (!wasActive) {
      renderTabs();
      return;
    }

    if (!tabs.length) {
      activeTabId = null;
      renderTabs();
      if (rawExitMap) await rawExitMap();
      return;
    }

    const replacement = tabs[Math.min(index, tabs.length - 1)];
    activeTabId = null;
    renderTabs();
    await switchTab(replacement.id, { skipCapture: true });
  }

  if (rawExitMap) {
    const wrappedExitMap = async function() {
      const current = activeTab();
      if (current) return closeTab(current.id);
      return rawExitMap();
    };
    window.exitMap = wrappedExitMap;
    try { exitMap = wrappedExitMap; } catch {}
  }

  if (rawUpdateTitle) {
    const wrappedUpdateTitle = function(...args) {
      const result = rawUpdateTitle(...args);
      const tab = activeTab();
      if (tab && S.project && tab.key === projectKey(S.project)) tab.dirty = Boolean(S.dirty);
      renderTabs();
      return result;
    };
    window.updateTitle = wrappedUpdateTitle;
    try { updateTitle = wrappedUpdateTitle; } catch {}
  }

  const saveAllButton = document.getElementById('toolbarSaveAll');
  if (saveAllButton) {
    saveAllButton.title = 'Save all open maps';
    saveAllButton.onclick = saveAllTabs;
  }

  function installResizableLayout() {
    const layout = document.querySelector('.editor-layout');
    const left = document.getElementById('leftPanel');
    const workspace = document.querySelector('.workspace-column');
    const viewport = document.getElementById('viewport');
    const bottom = document.getElementById('bottomPanel');
    const right = document.getElementById('rightPanel');
    if (!layout || !left || !workspace || !viewport || !bottom || !right) return;

    layout.classList.add('eph-resizable-layout');
    workspace.classList.add('eph-resizable-workspace');

    const defaultLeft = Math.round(left.getBoundingClientRect().width) || 312;
    const defaultRight = Math.round(right.getBoundingClientRect().width) || 350;
    const defaultBottom = Math.round(bottom.getBoundingClientRect().height) || 205;
    let leftWidth = Math.max(190, Math.min(680, Number(localStorage.getItem('eph-left-panel-width')) || defaultLeft));
    let rightWidth = Math.max(260, Math.min(560, defaultRight));
    let bottomHeight = Math.max(90, Math.min(520, Number(localStorage.getItem('eph-bottom-panel-height')) || defaultBottom));

    const rootStyle = document.documentElement.style;
    const applySizes = () => {
      rootStyle.setProperty('--eph-left-width', `${Math.round(leftWidth)}px`);
      rootStyle.setProperty('--eph-right-width', `${Math.round(rightWidth)}px`);
      rootStyle.setProperty('--eph-bottom-height', `${Math.round(bottomHeight)}px`);
    };
    applySizes();

    const leftResizer = document.createElement('div');
    leftResizer.className = 'eph-left-resizer';
    leftResizer.title = 'Drag to resize Asset Browser';
    left.after(leftResizer);

    const bottomResizer = document.createElement('div');
    bottomResizer.className = 'eph-bottom-resizer';
    bottomResizer.title = 'Drag to resize bottom panel';
    viewport.after(bottomResizer);

    const notifyViewport = () => {
      try { window.dispatchEvent(new Event('resize')); } catch {}
      requestAnimationFrame(updateChatAnchor);
    };

    leftResizer.addEventListener('pointerdown', event => {
      if (event.button !== 0 || left.classList.contains('panel-hidden')) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = leftWidth;
      document.body.classList.add('eph-resizing-left');
      const move = moveEvent => {
        leftWidth = Math.max(190, Math.min(Math.min(680, window.innerWidth * .6), startWidth + moveEvent.clientX - startX));
        rootStyle.setProperty('--eph-left-width', `${Math.round(leftWidth)}px`);
        notifyViewport();
      };
      const up = () => {
        document.body.classList.remove('eph-resizing-left');
        localStorage.setItem('eph-left-panel-width', String(Math.round(leftWidth)));
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        notifyViewport();
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
    });

    bottomResizer.addEventListener('pointerdown', event => {
      if (event.button !== 0 || bottom.classList.contains('panel-hidden')) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = bottomHeight;
      document.body.classList.add('eph-resizing-bottom');
      const move = moveEvent => {
        const maxHeight = Math.max(90, workspace.getBoundingClientRect().height - 150);
        bottomHeight = Math.max(90, Math.min(Math.min(520, maxHeight), startHeight - (moveEvent.clientY - startY)));
        rootStyle.setProperty('--eph-bottom-height', `${Math.round(bottomHeight)}px`);
        notifyViewport();
      };
      const up = () => {
        document.body.classList.remove('eph-resizing-bottom');
        localStorage.setItem('eph-bottom-panel-height', String(Math.round(bottomHeight)));
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        notifyViewport();
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
    });

    const railToggle = document.createElement('button');
    railToggle.type = 'button';
    railToggle.className = 'eph-toolrail-toggle';
    railToggle.title = 'Hide tool rail';
    left.appendChild(railToggle);

    const applyToolRail = hidden => {
      left.classList.toggle('eph-toolrail-hidden', hidden);
      railToggle.textContent = hidden ? '›' : '‹';
      railToggle.title = hidden ? 'Show tool rail' : 'Hide tool rail';
      localStorage.setItem('eph-toolrail-hidden', hidden ? '1' : '0');
      notifyViewport();
    };
    applyToolRail(localStorage.getItem('eph-toolrail-hidden') === '1');
    railToggle.onclick = () => applyToolRail(!left.classList.contains('eph-toolrail-hidden'));

    const viewMenu = document.getElementById('viewMenu');
    if (viewMenu && !document.getElementById('ephToggleToolRailMenu')) {
      const button = document.createElement('button');
      button.id = 'ephToggleToolRailMenu';
      button.type = 'button';
      button.textContent = 'Toggle Tool Rail';
      button.onclick = () => {
        applyToolRail(!left.classList.contains('eph-toolrail-hidden'));
        window.closeMenus?.();
      };
      viewMenu.appendChild(button);
    }

    function syncHiddenPanels() {
      const leftHidden = left.classList.contains('panel-hidden');
      const rightHidden = right.classList.contains('panel-hidden');
      const bottomHidden = bottom.classList.contains('panel-hidden');
      layout.classList.toggle('eph-left-panel-hidden', leftHidden);
      layout.classList.toggle('eph-right-panel-hidden', rightHidden);
      workspace.classList.toggle('eph-bottom-panel-hidden', bottomHidden);
      leftResizer.hidden = leftHidden;
      bottomResizer.hidden = bottomHidden;
      requestAnimationFrame(updateChatAnchor);
      notifyViewport();
    }

    const panelObserver = new MutationObserver(syncHiddenPanels);
    for (const panel of [left, right, bottom]) panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });

    function updateChatAnchor() {
      const rect = viewport.getBoundingClientRect();
      if (!rect.width) return;
      const offset = Math.max(20, Math.round(window.innerWidth - rect.right + 28));
      rootStyle.setProperty('--eph-chat-right-offset', `${offset}px`);
    }

    const resizeObserver = new ResizeObserver(() => {
      const measuredRight = right.classList.contains('panel-hidden') ? 0 : Math.round(right.getBoundingClientRect().width);
      if (measuredRight >= 260 && measuredRight <= 700) rightWidth = measuredRight;
      updateChatAnchor();
    });
    resizeObserver.observe(viewport);
    resizeObserver.observe(right);
    window.addEventListener('resize', updateChatAnchor);
    syncHiddenPanels();
    updateChatAnchor();
  }

  installResizableLayout();
  if (S.project && S.doc) registerCurrent();

  window.EPH_MAP_TABS = {
    list: () => tabs.map(tab => ({ id: tab.id, name: tab.project?.name, path: tab.project?.vmapPath, dirty: tab.dirty, active: tab.id === activeTabId })),
    switchTo: switchTab,
    close: closeTab,
    saveAll: saveAllTabs,
    open: openAdditionalMap,
  };
})();