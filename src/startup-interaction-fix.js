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
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) prepareEditorButtons(node);
    });
    observer.observe(editor, { childList: true, subtree: true });
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

  loadPass('large-map-stream-v21.js', '__ephLargeMapStreamV21');
  loadPass('large-map-spatial-v19.js', '__ephLargeMapSpatialV19');
  loadPass('complex-vmap-v15.js', '__ephComplexVmapV15');
  loadPass('visual-clean-v16.js', '__ephVisualCleanV16');
  loadPass('project-name-guard-v16.js', '__ephProjectNameGuardV16');
  loadPass('diagnostics-v16.js', '__ephDiagnosticsV16');
  loadPass('diagnostics-v18.js', '__ephDiagnosticsV18');
  loadPass('entity-fidelity-v17.js', '__ephEntityFidelityV17');
  loadPass('fgd-editor-model-guard-v18.js', '__ephFgdEditorModelGuardV18');
  loadPass('entity-fidelity-v18.js', '__ephEntityFidelityV18');
  loadPass('map-local-assets-v19.js', '__ephMapLocalAssetsV19');
  loadPass('map-local-fast-v21.js', '__ephMapLocalFastV21');
  loadPass('render-performance-v20.js', '__ephRenderPerformanceV20');
  loadPass('entity-runtime-v21.js', '__ephEntityRuntimeV21');
  loadPass('source2-coordinates-v23.js', '__ephSource2CoordinatesV23');
  loadPass('scale-tool-v21.js', '__ephScaleToolV21');
  loadPass('scale-legacy-disable-v21.js', '__ephScaleLegacyDisableV21');
  loadPass('transform-precision-v23.js', '__ephTransformPrecisionV23');
  loadPass('large-map-bootstrap-v21.js', '__ephLargeMapBootstrapV21');
  loadPass('collab-chat-v22.js', '__ephCollabChatV22');
  loadPass('multi-select-v22.js', '__ephMultiSelectV22');
  loadPass('multi-select-coordinates-v23.js', '__ephMultiSelectCoordinatesV23');
  loadPass('collab-local-view-v23.js', '__ephCollabLocalViewV23');
  loadPass('local-history-v22.js', '__ephLocalHistoryV22');
  loadPass('history-bindings-v22.js', '__ephHistoryBindingsV22');
  loadPass('negative-brush-v22.js', '__ephNegativeBrushV22');
  loadPass('negative-brush-safety-v22.js', '__ephNegativeBrushSafetyV22');
  loadPass('properties-scroll-v23.js', '__ephPropertiesScrollV23');
  loadPass('solid-entity-runtime-v24.js', '__ephSolidEntityRuntimeV24');

  repair();
  requestAnimationFrame(repair);
  setTimeout(repair, 100);
  setTimeout(repair, 500);
  setTimeout(repair, 1500);
  window.addEventListener('pageshow', repair, { once: true });
  window.addEventListener('eph3d-ready', repair, { once: true });
})();
