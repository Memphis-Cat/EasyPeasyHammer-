// byanca
(() => {
  'use strict';

  const api = window.easyPeasyHammer;
  const projectActionIds = ['openVmapButton', 'createProjectButton', 'continueButton'];
  let replayingReadyClick = false;

  function installModernStartup() {
    if (!document.querySelector('link[href="startup-modern-v53.css"]')) {
      const style = document.createElement('link');
      style.id = 'ephStartupModernV53Style';
      style.rel = 'stylesheet';
      style.href = 'startup-modern-v53.css';
      document.head.appendChild(style);
    }
    if (!document.querySelector('link[href="startup-modern-v54.css"]')) {
      const refinement = document.createElement('link');
      refinement.id = 'ephStartupModernV54Style';
      refinement.rel = 'stylesheet';
      refinement.href = 'startup-modern-v54.css';
      document.head.appendChild(refinement);
    }

    const screen = document.getElementById('startupScreen');
    const card = screen?.querySelector('.startup-card');
    if (!screen || !card) return;
    screen.classList.add('eph-modern-startup-screen');
    card.classList.add('eph-modern-startup', 'eph-recent-startup');

    // The old single-map startup widgets remain as compatibility anchors for
    // renderer.js, but never become part of the visible startup UI again.
    for (const id of ['resumePanel', 'forgetSessionButton']) {
      const legacy = document.getElementById(id);
      if (!legacy) continue;
      legacy.classList.add('hidden');
      legacy.hidden = true;
      legacy.setAttribute('aria-hidden', 'true');
      legacy.style.display = 'none';
    }

    // Build the modern recent-project surface before the deterministic runtime
    // finishes. startup-recents-v14 reuses this exact DOM instead of replacing
    // it, so there is no flash of the old menu while the editor initializes.
    if (!document.getElementById('ephRecentMaps')) {
      const section = document.createElement('section');
      section.id = 'ephRecentMaps';
      section.className = 'eph-recent-maps';
      section.innerHTML = `
        <div class="eph-recent-maps-header">
          <div class="eph-recent-maps-title">Recent projects</div>
          <div class="eph-recent-maps-hint">Open a map to continue</div>
        </div>
        <div id="ephRecentMapsList" class="eph-recent-maps-list">
          <div class="eph-recent-maps-empty">Loading recent maps…</div>
        </div>`;
      const actions = card.querySelector('.startup-actions');
      if (actions) card.insertBefore(section, actions);
      else card.appendChild(section);
    }
  }

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

  function installRuntimeGate() {
    if (document.documentElement.dataset.ephRuntimeGate === '1') return;
    document.documentElement.dataset.ephRuntimeGate = '1';
    document.addEventListener('click', event => {
      if (replayingReadyClick || document.documentElement.dataset.ephRuntimeReady === '1') return;
      const target = event.target?.closest?.('#openVmapButton, #continueButton, #toolbarOpen, [data-action="open-vmap"]');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      Promise.resolve(window.EPH_RUNTIME_READY).finally(() => {
        if (!target.isConnected) return;
        replayingReadyClick = true;
        try { target.click(); } finally { replayingReadyClick = false; }
      });
    }, true);
  }

  function repair() {
    installModernStartup();
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
    installRuntimeGate();
  }

  // project-dialog.js is the only runtime script loader. This file owns the
  // immediate startup shell, input/window interaction and readiness gate.
  repair();
  requestAnimationFrame(repair);
  setTimeout(repair, 100);
  setTimeout(repair, 500);
  window.addEventListener('pageshow', repair, { once: true });
  window.addEventListener('eph-runtime-ready', repair, { once: true });
})();
