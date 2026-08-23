// byanca
(() => {
  'use strict';
  if (window.__ephViewportLayoutIntegrityV35) return;
  window.__ephViewportLayoutIntegrityV35 = true;

  const api = window.easyPeasyHammer;
  let repairedCount = 0;
  let lastFailureSignature = '';

  const style = document.createElement('style');
  style.id = 'ephViewportLayoutIntegrityV35';
  style.textContent = `
    #app {
      min-width: 0 !important;
      min-height: 0 !important;
    }
    #editorScreen.editor-screen {
      min-width: 0 !important;
      min-height: 0 !important;
      overflow: hidden !important;
      grid-template-rows: auto minmax(0, 1fr) 36px !important;
    }
    #editorScreen > .editor-layout {
      min-width: 0 !important;
      min-height: 0 !important;
      height: 100% !important;
      overflow: hidden !important;
    }
    #editorScreen .workspace-column {
      min-width: 0 !important;
      min-height: 0 !important;
      height: 100% !important;
      overflow: hidden !important;
      grid-template-rows: minmax(0, 1fr) 205px !important;
    }
    #editorScreen .workspace-column:has(> #bottomPanel.panel-hidden) {
      grid-template-rows: minmax(0, 1fr) !important;
    }
    #editorScreen #viewport.viewport {
      min-width: 0 !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
    #editorScreen #threeViewport.three-viewport {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
    }
    #editorScreen #threeViewport > canvas {
      display: block !important;
      width: 100% !important;
      height: 100% !important;
    }
  `;
  document.head.appendChild(style);

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Viewport Layout V35] ${message}`, meta || '');
    try { api?.appLog?.(level, 'viewport-layout-v35', message, meta)?.catch?.(() => {}); } catch {}
  }

  function rect(element) {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      client: [element.clientWidth || 0, element.clientHeight || 0],
      rect: [Number(box.width.toFixed(1)), Number(box.height.toFixed(1))],
      display: getComputedStyle(element).display,
    };
  }

  function chainState() {
    const app = document.getElementById('app');
    const editor = document.getElementById('editorScreen');
    const header = editor?.querySelector(':scope > .app-header');
    const layout = editor?.querySelector(':scope > .editor-layout');
    const workspace = layout?.querySelector(':scope > .workspace-column');
    const viewportElement = document.getElementById('viewport');
    const container = document.getElementById('threeViewport');
    const canvas = window.EPH3D?.renderer?.domElement || container?.querySelector('canvas') || null;
    const footer = editor?.querySelector(':scope > .status-bar');
    return {
      app: rect(app),
      editor: rect(editor),
      header: rect(header),
      layout: rect(layout),
      workspace: rect(workspace),
      viewport: rect(viewportElement),
      container: rect(container),
      canvas: rect(canvas),
      drawingBuffer: canvas ? [canvas.width || 0, canvas.height || 0] : null,
      inner: [window.innerWidth, window.innerHeight],
      footer: rect(footer),
    };
  }

  function forceVerticalContract() {
    const app = document.getElementById('app');
    const editor = document.getElementById('editorScreen');
    const header = editor?.querySelector(':scope > .app-header');
    const layout = editor?.querySelector(':scope > .editor-layout');
    const workspace = layout?.querySelector(':scope > .workspace-column');
    const viewportElement = document.getElementById('viewport');
    const container = document.getElementById('threeViewport');
    const footer = editor?.querySelector(':scope > .status-bar');
    if (!app || !editor || !layout || !workspace || !viewportElement || !container) return false;

    editor.style.setProperty('display', 'grid', 'important');
    editor.style.setProperty('grid-template-rows', 'auto minmax(0, 1fr) 36px', 'important');
    editor.style.setProperty('min-height', '0', 'important');
    editor.style.setProperty('overflow', 'hidden', 'important');

    layout.style.setProperty('min-height', '0', 'important');
    layout.style.setProperty('overflow', 'hidden', 'important');
    workspace.style.setProperty('min-height', '0', 'important');
    workspace.style.setProperty('overflow', 'hidden', 'important');
    viewportElement.style.setProperty('min-height', '0', 'important');
    container.style.setProperty('height', '100%', 'important');
    container.style.setProperty('min-height', '0', 'important');

    // If Chromium kept the hidden-screen grid track at zero, percentage heights
    // cannot recover it because they keep resolving against that zero track.
    // Give the editor and middle row concrete fallback heights from the visible
    // application box, then let the normal grid own sizing again on resize.
    const appStyle = getComputedStyle(app);
    const appPadding = (Number.parseFloat(appStyle.paddingTop) || 0) + (Number.parseFloat(appStyle.paddingBottom) || 0);
    const appContentHeight = Math.max(1, Math.floor((app.clientHeight || window.innerHeight || 1) - appPadding));
    let editorHeight = editor.getBoundingClientRect().height;
    if (editorHeight < 2 && appContentHeight > 1) {
      editor.style.setProperty('height', `${appContentHeight}px`, 'important');
      editorHeight = editor.getBoundingClientRect().height || appContentHeight;
    }

    const headerHeight = header?.getBoundingClientRect().height || 0;
    const footerHeight = footer?.getBoundingClientRect().height || 36;
    const available = Math.max(1, Math.floor(editorHeight - headerHeight - footerHeight));
    if (layout.getBoundingClientRect().height < 2 && available > 1) {
      layout.style.setProperty('height', `${available}px`, 'important');
      workspace.style.setProperty('height', '100%', 'important');
    }

    const bottom = document.getElementById('bottomPanel');
    if (bottom?.classList.contains('panel-hidden')) {
      workspace.style.setProperty('grid-template-rows', 'minmax(0, 1fr)', 'important');
    } else {
      const workspaceHeight = workspace.getBoundingClientRect().height || available;
      const bottomHeight = Math.max(0, Math.min(205, Math.max(0, workspaceHeight - 120)));
      workspace.style.setProperty('grid-template-rows', `minmax(0, 1fr) ${bottomHeight}px`, 'important');
    }

    // Force style/layout resolution before asking Three.js to size its buffer.
    void container.offsetHeight;
    return true;
  }

  function repair(reason = 'health') {
    const editor = document.getElementById('editorScreen');
    if (!editor || editor.classList.contains('hidden')) return false;
    const viewport = window.EPH3D;
    const container = viewport?.container || document.getElementById('threeViewport');
    if (!container) return false;

    let height = container.getBoundingClientRect().height;
    let width = container.getBoundingClientRect().width;
    let forced = false;
    if (width < 2 || height < 2) {
      forced = forceVerticalContract();
      width = container.getBoundingClientRect().width;
      height = container.getBoundingClientRect().height;
    }

    if (width >= 2 && height >= 2) {
      try { viewport?.resize?.(); } catch (error) {
        report('error', 'Three.js resize failed after layout recovery.', error?.stack || error?.message || String(error));
      }
      const canvas = viewport?.renderer?.domElement;
      if (canvas && (canvas.width < 2 || canvas.height < 2)) {
        try {
          const ratio = viewport.renderer.getPixelRatio?.() || 1;
          if (ratio <= 0) viewport.renderer.setPixelRatio(1);
          viewport.renderer.setSize(Math.floor(width), Math.floor(height), false);
          viewport.camera.aspect = width / height;
          viewport.camera.updateProjectionMatrix();
        } catch (error) {
          report('error', 'WebGL backing-buffer resize failed.', error?.stack || error?.message || String(error));
        }
      }
      if (forced) {
        repairedCount++;
        report('warning', 'Recovered a zero-size editor viewport.', { reason, repairedCount, state: chainState() });
      }
      lastFailureSignature = '';
      return true;
    }

    const state = chainState();
    const signature = JSON.stringify(state);
    if (signature !== lastFailureSignature) {
      lastFailureSignature = signature;
      report('error', 'Viewport layout is still zero-sized after forced recovery.', { reason, state });
    }
    return false;
  }

  const editor = document.getElementById('editorScreen');
  const layout = editor?.querySelector(':scope > .editor-layout');
  const workspace = layout?.querySelector(':scope > .workspace-column');
  const viewportElement = document.getElementById('viewport');
  const bottom = document.getElementById('bottomPanel');

  const resizeObserver = new ResizeObserver(() => repair('resize-observer'));
  for (const element of [document.getElementById('app'), editor, layout, workspace, viewportElement]) {
    if (element) resizeObserver.observe(element);
  }

  const mutationObserver = new MutationObserver(() => requestAnimationFrame(() => repair('layout-class-change')));
  if (editor) mutationObserver.observe(editor, { attributes: true, attributeFilter: ['class', 'style'] });
  for (const element of [document.getElementById('leftPanel'), document.getElementById('rightPanel'), bottom]) {
    if (element) mutationObserver.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  window.addEventListener('resize', () => repair('window-resize'), { passive: true });
  window.addEventListener('eph3d-ready', () => repair('viewport-ready'), { once: true });
  window.addEventListener('eph-runtime-ready', () => repair('runtime-ready'), { once: true });

  [0, 16, 60, 180, 500, 1200].forEach(delay => setTimeout(() => repair(`startup-${delay}`), delay));

  window.EPH_VIEWPORT_LAYOUT = {
    repair: () => repair('manual'),
    state: chainState,
    repairedCount: () => repairedCount,
  };
  report('normal', 'Zero-height viewport prevention and recovery installed.');
})();
