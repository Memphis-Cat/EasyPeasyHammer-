// byanca
(() => {
  'use strict';

  const api = window.easyPeasyHammer;
  const projectActionIds = ['openVmapButton', 'createProjectButton', 'continueButton'];

  function makeInteractive(element) {
    if (!element) return;
    element.style.pointerEvents = 'auto';
    element.style.webkitAppRegion = 'no-drag';
  }

  function prepareEditorButtons(root) {
    if (!root) return;
    const buttons = root.matches?.('button') ? [root] : [...(root.querySelectorAll?.('button') || [])];
    for (const button of buttons) {
      button.tabIndex = -1;
      button.setAttribute('tabindex', '-1');
    }
  }

  function installEditorButtonFocusGuard() {
    const editor = document.getElementById('editorScreen');
    if (!editor || editor.dataset.ephButtonFocusGuard === '1') return;
    editor.dataset.ephButtonFocusGuard = '1';
    prepareEditorButtons(editor);
    editor.addEventListener('focusin', event => {
      const button = event.target?.closest?.('button');
      if (button && editor.contains(button)) button.blur();
    }, true);
    editor.addEventListener('click', event => {
      const button = event.target?.closest?.('button');
      if (!button || !editor.contains(button)) return;
      queueMicrotask(() => button.isConnected && button.blur());
    }, true);
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) prepareEditorButtons(node);
    }).observe(editor, { childList: true, subtree: true });
  }

  function repair() {
    for (const id of projectActionIds) {
      const button = document.getElementById(id);
      if (!button) continue;
      makeInteractive(button);
    }
    document.querySelectorAll('#startupScreen button, #startupScreen input, #newProjectModal button, #newProjectModal input, .eph-window-controls, .eph-window-controls button').forEach(makeInteractive);
    const minimize = document.getElementById('ephMinimize');
    const maximize = document.getElementById('ephMaximize');
    const close = document.getElementById('ephClose');
    if (minimize) minimize.onclick = event => { event.preventDefault(); event.stopPropagation(); api?.windowMinimize?.(); };
    if (maximize) maximize.onclick = async event => {
      event.preventDefault(); event.stopPropagation();
      const maximized = await api?.windowToggleMaximize?.();
      maximize.textContent = maximized ? '❐' : '□';
      maximize.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
    };
    if (close) close.onclick = event => { event.preventDefault(); event.stopPropagation(); api?.windowClose?.(); };
    installEditorButtonFocusGuard();
  }

  // This file used to launch a second independent script loader while
  // project-dialog.js was already loading renderer enhancements sequentially.
  // That made viewport method replacement order depend on network/disk timing.
  // project-dialog.js is now the only runtime loader; this file only repairs UI.
  repair();
  requestAnimationFrame(repair);
  setTimeout(repair, 100);
  setTimeout(repair, 500);
  window.addEventListener('pageshow', repair, { once: true });
  window.addEventListener('eph-runtime-ready', repair, { once: true });
})();
