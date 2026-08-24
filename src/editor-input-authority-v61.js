// byanca
(() => {
  'use strict';
  if (window.__ephEditorInputAuthorityV61) return;
  window.__ephEditorInputAuthorityV61 = true;

  const VMAP = window.EPH_VMAP;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewport = () => window.EPH3D || state()?.viewport || null;
  const objectById = id => state()?.objects?.find(object => object?.id === id) || null;
  const TOOL_NAMES = new Set(['select', 'move', 'rotate', 'scale']);

  let boxPointer = null;
  let leftPointer = null;
  let replayingPointerUp = false;
  let toolIntent = null;
  let toolIntentSerial = 0;

  function canvasFor(vp = viewport()) {
    return vp?.renderer?.domElement || null;
  }

  function targetsCanvas(event, canvas) {
    if (!canvas) return false;
    return event.target === canvas || Boolean(event.composedPath?.().includes(canvas));
  }

  function hitId(event) {
    try { return window.EPH_SURFACE_MOVE_V39?.selectAt?.(event) || null; }
    catch { return null; }
  }

  function hideSelectionRectangle() {
    document.querySelectorAll('.eph-selection-rect').forEach(rect => {
      rect.style.display = 'none';
      rect.style.width = '0px';
      rect.style.height = '0px';
    });
  }

  function replayPointerUp(info, clientX, clientY) {
    const vp = viewport();
    const canvas = canvasFor(vp);
    if (!canvas || !info || replayingPointerUp || typeof PointerEvent !== 'function') return false;

    replayingPointerUp = true;
    try {
      const synthetic = new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: info.pointerId,
        pointerType: info.pointerType || 'mouse',
        isPrimary: info.isPrimary !== false,
        clientX: Number.isFinite(clientX) ? clientX : info.clientX,
        clientY: Number.isFinite(clientY) ? clientY : info.clientY,
        button: -1,
        buttons: 0,
        pressure: 0,
      });
      canvas.dispatchEvent(synthetic);
      return true;
    } catch (error) {
      console.warn('[Editor Input V61] Could not replay the selection pointer release.', error);
      return false;
    } finally {
      replayingPointerUp = false;
      hideSelectionRectangle();
    }
  }

  function releaseStuckTransform(vp = viewport()) {
    const transform = vp?.transform;
    if (!transform?.dragging) return false;

    try { transform.dragging = false; } catch {}
    try { if (vp.orbit) vp.orbit.enabled = true; } catch {}
    try { transform.dispatchEvent?.({ type: 'dragging-changed', value: false }); } catch {}
    try { transform.axis = null; } catch {}
    return true;
  }

  function finishPhysicalPointer(event = null) {
    const pointerId = event?.pointerId;
    if (boxPointer && (pointerId == null || boxPointer.pointerId === pointerId)) {
      const info = boxPointer;
      boxPointer = null;
      replayPointerUp(info, event?.clientX, event?.clientY);
    }
    if (leftPointer && (pointerId == null || leftPointer.pointerId === pointerId)) leftPointer = null;
    queueMicrotask(() => releaseStuckTransform());
  }

  function knownToolHosts() {
    const result = [];
    const moveSnap = document.getElementById('ephMoveSnap');
    if (moveSnap?.parentElement) result.push([moveSnap.parentElement, 'move']);
    const rotate = document.querySelector('.rotate-options');
    if (rotate) result.push([rotate, 'rotate']);
    const scale = document.getElementById('ephScaleV21');
    if (scale) result.push([scale, 'scale']);
    return result;
  }

  function syncToolUi(tool) {
    const active = String(tool || 'select').toLowerCase();
    const editor = document.getElementById('editorScreen');
    if (editor) editor.dataset.ephV61Tool = active;

    for (const [host, owner] of knownToolHosts()) {
      const shown = owner === active;
      host.style.setProperty('display', shown ? 'inline-flex' : 'none', 'important');
      host.style.setProperty('visibility', shown ? 'visible' : 'hidden', 'important');
      host.style.setProperty('pointer-events', shown ? 'auto' : 'none', 'important');
    }

    document.querySelectorAll('.tool-mode[data-tool], #toolRail [data-tool]').forEach(button => {
      const selected = String(button.dataset.tool || '').toLowerCase() === active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });

    try { window.EPH_EDITOR_CORRECTNESS_V59?.syncToolUi?.(active); } catch {}
  }

  function attachCurrentTransform(vp, tool) {
    if (!vp?.transform || !['move', 'rotate', 'scale'].includes(tool)) return;

    try { window.EPH_MESH_ENTITY_TRANSFORM_V31?.attach?.(); } catch {}
    if (!vp.transform.object) {
      const s = state();
      const primary = vp.selectedId || s?.selectedId || null;
      const root = primary ? vp.objectRoots?.get?.(primary) : null;
      if (root) {
        try {
          if (typeof vp.attachObjectTransform === 'function') vp.attachObjectTransform(root);
          else vp.transform.attach?.(root);
        } catch {}
      }
    }
  }

  function applyTool(tool, serial = toolIntentSerial) {
    const name = String(tool || '').toLowerCase();
    if (!TOOL_NAMES.has(name) || serial !== toolIntentSerial) return false;

    const s = state();
    const vp = viewport();
    toolIntent = name;
    releaseStuckTransform(vp);

    if (s) s.tool = name;
    if (vp) {
      try { vp.setTool?.(name); } catch {}
      vp.tool = name;
      const transformMode = name === 'move' ? 'translate' : name;
      if (['move', 'rotate', 'scale'].includes(name)) {
        attachCurrentTransform(vp, name);
        try { vp.transform?.setMode?.(transformMode); } catch {}
        if (name === 'scale') {
          try { vp.transform?.setSpace?.('local'); } catch {}
        } else {
          const space = String(vp.space || s?.space || 'Local').toLowerCase() === 'world' ? 'world' : 'local';
          try { vp.transform?.setSpace?.(space); } catch {}
        }
      } else {
        try { vp.transform?.detach?.(); } catch {}
      }
    }

    syncToolUi(name);
    try { renderTools?.(); } catch {}
    syncToolUi(name);
    return true;
  }

  function chooseTool(tool) {
    const name = String(tool || '').toLowerCase();
    if (!TOOL_NAMES.has(name)) return false;
    const serial = ++toolIntentSerial;
    toolIntent = name;
    applyTool(name, serial);
    queueMicrotask(() => applyTool(name, serial));
    requestAnimationFrame(() => applyTool(name, serial));
    setTimeout(() => applyTool(name, serial), 24);
    setTimeout(() => applyTool(name, serial), 90);
    return true;
  }

  function tryPickPart(event) {
    if (event.button !== 0) return false;
    const picker = window.EPH_FGD_REFERENCE_PICKER;
    const armed = picker?.armed?.();
    if (!armed || armed.kind?.mode !== 'entity' || typeof picker.assign !== 'function') return false;

    let id = event.target?.closest?.('#sceneTree .tree-row')?.dataset?.objectId || null;
    const vp = viewport();
    const canvas = canvasFor(vp);
    if (!id && targetsCanvas(event, canvas)) id = hitId(event);
    const object = objectById(id);
    if (!object || object.type !== 'part') return false;

    const value = String(object.name || object.dmxId || object.id || '').trim();
    if (!value) return false;

    event.preventDefault();
    event.stopImmediatePropagation();
    picker.assign(value, object.name || 'Part');
    return true;
  }

  function installEarlyCapture() {
    if (document.documentElement.dataset.ephInputAuthorityV61 === '1') return;
    document.documentElement.dataset.ephInputAuthorityV61 = '1';

    window.addEventListener('pointerdown', event => {
      if (tryPickPart(event)) return;

      const vp = viewport();
      const canvas = canvasFor(vp);
      if (!canvas || event.button !== 0 || !targetsCanvas(event, canvas)) return;

      leftPointer = {
        pointerId: event.pointerId,
        pointerType: event.pointerType || 'mouse',
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (vp.transform?.dragging || vp.transform?.axis) return;
      const id = hitId(event);
      if (id) return;
      boxPointer = { ...leftPointer };
    }, true);

    window.addEventListener('pointermove', event => {
      if (boxPointer && event.pointerId === boxPointer.pointerId) {
        boxPointer.clientX = event.clientX;
        boxPointer.clientY = event.clientY;
        if ((event.buttons & 1) === 0) finishPhysicalPointer(event);
      } else if (leftPointer && event.pointerId === leftPointer.pointerId && (event.buttons & 1) === 0) {
        leftPointer = null;
        queueMicrotask(() => releaseStuckTransform());
      }
    }, true);

    window.addEventListener('pointerup', event => {
      if (replayingPointerUp) return;
      finishPhysicalPointer(event);
    }, true);

    window.addEventListener('pointercancel', event => {
      if (replayingPointerUp) return;
      finishPhysicalPointer(event);
    }, true);

    window.addEventListener('blur', () => finishPhysicalPointer(), true);

    window.addEventListener('click', event => {
      const button = event.target?.closest?.('.toolbar-row .tool-mode[data-tool], #toolRail [data-tool]');
      const tool = String(button?.dataset?.tool || '').toLowerCase();
      if (!TOOL_NAMES.has(tool)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      chooseTool(tool);
    }, true);
  }

  function install() {
    installEarlyCapture();
    const s = state();
    const currentTool = String(toolIntent || s?.tool || viewport()?.tool || 'select').toLowerCase();
    if (TOOL_NAMES.has(currentTool)) syncToolUi(currentTool);
  }

  install();
  window.addEventListener('eph3d-ready', install);
  window.addEventListener('eph-runtime-ready', () => {
    install();
    const active = String(toolIntent || state()?.tool || viewport()?.tool || 'select').toLowerCase();
    if (TOOL_NAMES.has(active)) {
      const serial = ++toolIntentSerial;
      toolIntent = active;
      requestAnimationFrame(() => applyTool(active, serial));
    }
  }, { once: true });

  window.EPH_EDITOR_INPUT_AUTHORITY_V61 = {
    install,
    chooseTool,
    releaseStuckTransform,
    hideSelectionRectangle,
    tryPickPart,
  };

  console.info('[Editor Input V61] Pointer release, authoritative tool switching, and Part reference picking installed.');
})();