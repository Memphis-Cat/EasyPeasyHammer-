// byanca
(() => {
  'use strict';

  const api = window.easyPeasyHammer;
  const projectActionIds = ['openVmapButton', 'createProjectButton', 'continueButton'];
  const MIN_PART_SCALE = 0.01;

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
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) prepareEditorButtons(node);
    });
    observer.observe(editor, { childList: true, subtree: true });
  }

  function clampLivePartScale(root) {
    if (!root) return;
    const safe = value => {
      const number = Number(value);
      if (!Number.isFinite(number)) return 1;
      return Math.max(MIN_PART_SCALE, number);
    };
    root.scale.set(safe(root.scale.x), safe(root.scale.y), safe(root.scale.z));
  }

  function updateLiveScaleFields(object) {
    if (!object?.scale) return;
    document.querySelectorAll('.prop-value[data-key="scale"]').forEach(input => {
      const index = Number(input.dataset.i);
      const value = Number(object.scale[index]);
      if (Number.isFinite(value)) input.value = String(Number(value.toFixed(4)));
    });
  }

  function installStablePartScaling() {
    const viewport = window.EPH3D;
    if (!viewport) return false;
    if (!viewport.__ephStableScaleSync && typeof viewport.syncSelectedFromRoot === 'function') {
      viewport.__ephStableScaleSync = true;
      const previousSync = viewport.syncSelectedFromRoot.bind(viewport);
      viewport.syncSelectedFromRoot = function(commit) {
        const object = this.getObjectById?.(this.selectedId);
        const root = this.objectRoots?.get?.(this.selectedId);
        if (this.tool === 'scale' && object?.type === 'part' && root) clampLivePartScale(root);
        const result = previousSync(commit);
        if (this.tool === 'scale' && object?.type === 'part') this.updateSelectionBox?.();
        return result;
      };
    }
    const change = viewport.callbacks?.change;
    if (typeof change === 'function' && !change.__ephStableScaleChange) {
      const previousChange = change;
      const stableChange = function(object, commit) {
        if (viewport.tool === 'scale' && object?.type === 'part' && commit !== true) {
          updateLiveScaleFields(object);
          return;
        }
        return previousChange(object, commit);
      };
      stableChange.__ephStableScaleChange = true;
      stableChange.__ephPreviousChange = previousChange;
      viewport.callbacks.change = stableChange;
    }
    return true;
  }

  function repair() {
    for (const id of projectActionIds) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.disabled = false;
      button.removeAttribute('aria-disabled');
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
    installStablePartScaling();
  }

  function loadPass(src, marker) {
    if (window[marker] || document.querySelector(`script[data-eph-pass="${src}"]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.ephPass = src;
    script.onerror = () => console.error(`EasyPeasyHammer pass failed: ${src}`);
    document.body.appendChild(script);
  }

  loadPass('large-map-stream-v16.js', '__ephLargeMapStreamV16');
  loadPass('large-map-spatial-v19.js', '__ephLargeMapSpatialV19');
  loadPass('complex-vmap-v15.js', '__ephComplexVmapV15');
  loadPass('visual-clean-v16.js', '__ephVisualCleanV16');
  loadPass('project-name-guard-v16.js', '__ephProjectNameGuardV16');
  loadPass('diagnostics-v16.js', '__ephDiagnosticsV16');
  loadPass('diagnostics-v18.js', '__ephDiagnosticsV18');
  loadPass('entity-fidelity-v17.js', '__ephEntityFidelityV17');
  loadPass('fgd-editor-model-guard-v18.js', '__ephFgdEditorModelGuardV18');
  loadPass('entity-fidelity-v18.js', '__ephEntityFidelityV18');
  loadPass('large-map-bootstrap-v18.js', '__ephLargeMapBootstrapV18');

  repair();
  requestAnimationFrame(repair);
  setTimeout(repair, 100);
  setTimeout(repair, 500);
  setTimeout(repair, 1500);
  window.addEventListener('pageshow', repair, { once: true });
  window.addEventListener('eph3d-ready', repair, { once: true });
})();
