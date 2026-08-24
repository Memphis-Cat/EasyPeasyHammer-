// byanca
(() => {
  'use strict';
  if (window.__ephEditorPolishV62) return;
  window.__ephEditorPolishV62 = true;

  const VMAP = window.EPH_VMAP;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewport = () => window.EPH3D || state()?.viewport || null;
  const objectById = id => state()?.objects?.find(object => object?.id === id) || null;
  const TOOL_NAMES = new Set(['select', 'move', 'rotate', 'scale']);

  let intendedTool = null;
  let customPartPick = null;
  let leftPointerDown = false;
  let lastPointer = null;

  function ensureStyle() {
    if (document.getElementById('ephEditorPolishV62Style')) return;
    const style = document.createElement('style');
    style.id = 'ephEditorPolishV62Style';
    style.textContent = `
      #editorScreen .axis-widget{display:none!important}
      #editorScreen .viewport-top-right .viewport-icon{
        width:34px!important;min-width:34px!important;max-width:34px!important;
        height:34px!important;min-height:34px!important;padding:0!important;
        overflow:hidden!important;white-space:nowrap!important;font-size:0!important;line-height:0!important;
      }
      #editorScreen .viewport-top-right .viewport-icon::before,
      #editorScreen .viewport-top-right .viewport-icon::after{content:none!important;display:none!important}
      #editorScreen .viewport-top-right .viewport-icon>span,
      #editorScreen .viewport-top-right .viewport-icon>label{display:none!important}
      #editorScreen .viewport-top-right .viewport-icon img{display:block!important;margin:auto!important;max-width:20px!important;max-height:20px!important}
      #editorScreen .move-options,#editorScreen .rotate-options,#editorScreen .scale-options,
      #editorScreen #ephScaleV21,#editorScreen [data-eph-tool-context]{display:none!important}
      #editorScreen[data-eph-v62-tool="move"] .move-options,
      #editorScreen[data-eph-v62-tool="move"] [data-eph-tool-context="move"],
      #editorScreen[data-eph-v62-tool="rotate"] .rotate-options,
      #editorScreen[data-eph-v62-tool="rotate"] [data-eph-tool-context="rotate"],
      #editorScreen[data-eph-v62-tool="scale"] .scale-options,
      #editorScreen[data-eph-v62-tool="scale"] #ephScaleV21,
      #editorScreen[data-eph-v62-tool="scale"] [data-eph-tool-context="scale"]{display:inline-flex!important;visibility:visible!important;pointer-events:auto!important}
      .eph-part-pick-v62{flex:0 0 auto;height:25px;padding:0 7px;border:1px solid #3b4149;border-radius:3px;background:#181b1f;color:#dfe6ef;font:10px Segoe UI,Arial,sans-serif;cursor:pointer}
      .eph-part-pick-v62:hover,.eph-part-pick-v62.armed{border-color:#fdaa15;background:#30220b;color:#fff}
      #ephFloatingChat{right:360px!important}
      @media(max-width:1400px){#ephFloatingChat{right:330px!important}}
    `;
    document.head.appendChild(style);
  }

  function cleanViewportButtons() {
    const labels = ['Cycle viewport', 'Toggle grid mode', 'More viewport options'];
    document.querySelectorAll('#editorScreen .viewport-top-right .viewport-icon').forEach((button, index) => {
      for (const node of [...button.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim()) node.remove();
      }
      for (const child of [...button.children]) if (child.tagName !== 'IMG') child.remove();
      const label = labels[index] || button.title || 'Viewport option';
      button.title = label;
      button.setAttribute('aria-label', label);
    });
  }

  function toolNodes() {
    const nodes = new Map();
    const add = (node, tool) => { if (node && !nodes.has(node)) nodes.set(node, tool); };
    document.querySelectorAll('#editorScreen .move-options').forEach(node => add(node, 'move'));
    document.querySelectorAll('#editorScreen .rotate-options').forEach(node => add(node, 'rotate'));
    document.querySelectorAll('#editorScreen .scale-options').forEach(node => add(node, 'scale'));
    const moveSnap = document.getElementById('ephMoveSnap');
    if (moveSnap?.parentElement && !moveSnap.parentElement.matches('.tool-mode')) add(moveSnap.parentElement, 'move');
    add(document.getElementById('ephScaleV21'), 'scale');
    document.querySelectorAll('#editorScreen [data-eph-tool-context]').forEach(node => add(node, node.dataset.ephToolContext));
    return nodes;
  }

  function syncToolUi(tool = null) {
    const s = state();
    const active = String(tool || intendedTool || s?.tool || viewport()?.tool || 'select').toLowerCase();
    if (!TOOL_NAMES.has(active)) return false;
    const editor = document.getElementById('editorScreen');
    if (!editor) return false;

    editor.dataset.ephV62Tool = active;
    editor.dataset.ephActiveTool = active;
    editor.dataset.ephV61Tool = active;
    for (const [node, owner] of toolNodes()) {
      const visible = owner === active;
      node.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
      node.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
      node.style.setProperty('pointer-events', visible ? 'auto' : 'none', 'important');
    }
    document.querySelectorAll('#editorScreen .tool-mode[data-tool], #editorScreen #toolRail [data-tool]').forEach(button => {
      const selected = String(button.dataset.tool || '').toLowerCase() === active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    return true;
  }

  function selectionRectVisible() {
    return [...document.querySelectorAll('.eph-selection-rect')].some(rect => {
      const style = getComputedStyle(rect);
      return style.display !== 'none' && style.visibility !== 'hidden' && (rect.offsetWidth > 0 || rect.offsetHeight > 0);
    });
  }

  function hideSelectionRect() {
    document.querySelectorAll('.eph-selection-rect').forEach(rect => {
      rect.style.setProperty('display', 'none', 'important');
      rect.style.width = '0px';
      rect.style.height = '0px';
    });
  }

  function releaseStuckTransform() {
    try { window.EPH_EDITOR_INPUT_AUTHORITY_V61?.releaseStuckTransform?.(); } catch {}
    const vp = viewport();
    if (vp?.transform?.dragging && !leftPointerDown) {
      try { vp.transform.dragging = false; } catch {}
      try { vp.transform.axis = null; } catch {}
      try { vp.transform.dispatchEvent?.({ type: 'dragging-changed', value: false }); } catch {}
      if (vp.orbit) vp.orbit.enabled = true;
    }
  }

  function forceLegacyPointerRelease(event = null) {
    const vp = viewport();
    const canvas = vp?.renderer?.domElement;
    if (!canvas || typeof PointerEvent !== 'function') return;
    const info = lastPointer || {};
    const pointerId = event?.pointerId ?? info.pointerId ?? 1;
    try {
      if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {}
    try {
      canvas.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: event?.pointerType || info.pointerType || 'mouse',
        isPrimary: true,
        clientX: event?.clientX ?? info.clientX ?? 0,
        clientY: event?.clientY ?? info.clientY ?? 0,
        button: 0,
        buttons: 0,
        pressure: 0,
      }));
    } catch {}
    hideSelectionRect();
    releaseStuckTransform();
  }

  function rawPartAt(event) {
    const rowId = event.target?.closest?.('#sceneTree .tree-row')?.dataset?.objectId;
    if (rowId) {
      const object = objectById(rowId);
      if (object?.type === 'part') return object;
    }

    const vp = viewport();
    const canvas = vp?.renderer?.domElement;
    if (!canvas || !(event.target === canvas || event.composedPath?.().includes(canvas))) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    vp.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    vp.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    vp.raycaster.setFromCamera(vp.pointer, vp.camera);
    const hits = vp.raycaster.intersectObjects([...vp.objectRoots.values()], true);
    const rootIds = new Map([...vp.objectRoots].map(([id, root]) => [root, id]));
    for (const hit of hits) {
      let node = hit.object;
      while (node && node !== vp.objectGroup) {
        const id = rootIds.get(node);
        if (id) {
          const object = objectById(id);
          if (object?.type === 'part') return object;
          break;
        }
        node = node.parent;
      }
    }
    return null;
  }

  function assignCustomPart(part) {
    const pick = customPartPick;
    const s = state();
    if (!pick || !part || !s) return false;
    const owner = objectById(pick.ownerId);
    if (!owner) { customPartPick = null; return false; }
    try { pushHistory?.(); } catch {}
    owner.entityProperties ||= {};
    const value = String(part.name || part.dmxId || part.id || '').trim();
    owner.entityProperties[pick.key] = value;
    if (owner.dmxId && s.doc) VMAP?.applyObjectToDocument?.(s.doc, owner);
    s.viewport?.updateObject?.(owner);
    try { markDirty?.(`Changed ${pick.key} on ${owner.name}`); } catch {}
    customPartPick = null;
    s.selectedId = owner.id;
    try { renderTree?.(); renderProperties?.(); } catch {}
    try { toast?.(`${pick.key}: ${value}`); } catch {}
    return true;
  }

  function interceptPartPick(event) {
    if (event.button !== 0) return false;
    const part = rawPartAt(event);
    if (!part) return false;

    if (customPartPick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return assignCustomPart(part);
    }

    const picker = window.EPH_FGD_REFERENCE_PICKER;
    const armed = picker?.armed?.();
    if (!armed || armed.kind?.mode === 'asset' || typeof picker.assign !== 'function') return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const value = String(part.name || part.dmxId || part.id || '').trim();
    picker.assign(value, part.name || 'Part');
    return true;
  }

  function decoratePartFields() {
    const owner = (() => { try { return current?.(); } catch { return objectById(state()?.selectedId); } })();
    if (!owner || !['entity', 'prop'].includes(owner.type)) return;
    document.querySelectorAll('#propertiesContent .eph-fgd-input[data-fgd-key]').forEach(input => {
      const key = String(input.dataset.fgdKey || '').toLowerCase();
      if (!/(mount|mounting|part|brush|volume|mesh|surface)/.test(key)) return;
      if (/(material|model|sound|particle|file|path|resource)/.test(key)) return;
      if (input.closest('.eph-fgd-ref-wrap-v43')) return;
      if (input.parentElement?.querySelector('.eph-part-pick-v62')) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'eph-part-pick-v62';
      button.textContent = 'Pick Part';
      button.title = 'Pick a Part from the viewport or Scene tree';
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        if (customPartPick?.ownerId === owner.id && customPartPick?.key === input.dataset.fgdKey) {
          customPartPick = null;
          button.classList.remove('armed');
          try { toast?.('Part picker cancelled.'); } catch {}
          return;
        }
        customPartPick = { ownerId: owner.id, key: input.dataset.fgdKey };
        document.querySelectorAll('.eph-part-pick-v62').forEach(item => item.classList.remove('armed'));
        button.classList.add('armed');
        try { toast?.(`Pick a Part for ${input.dataset.fgdKey}`); } catch {}
      };
      input.insertAdjacentElement('afterend', button);
    });
  }

  function repaintVisibleApp() {
    if (document.hidden) return;
    const vp = viewport();
    try { vp?.resize?.(); } catch {}
    try {
      if (vp?.renderer && vp?.scene && vp?.camera) {
        vp.renderer.setRenderTarget?.(null);
        vp.renderer.setScissorTest?.(false);
        vp.renderer.resetState?.();
        vp.renderer.render(vp.scene, vp.camera);
      }
    } catch {}
    try { window.EPH_RENDER_FRAME?.force?.(); } catch {}
  }

  function scheduleFocusPaint() {
    repaintVisibleApp();
    requestAnimationFrame(() => {
      repaintVisibleApp();
      requestAnimationFrame(repaintVisibleApp);
    });
  }

  function installEvents() {
    if (document.documentElement.dataset.ephPolishV62Events === '1') return;
    document.documentElement.dataset.ephPolishV62Events = '1';

    window.addEventListener('pointerdown', event => {
      if (interceptPartPick(event)) return;
      if (event.button === 0) {
        leftPointerDown = true;
        lastPointer = { pointerId: event.pointerId, pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY };
      }
      const button = event.target?.closest?.('#editorScreen .toolbar-row .tool-mode[data-tool], #editorScreen #toolRail [data-tool]');
      const tool = String(button?.dataset?.tool || '').toLowerCase();
      if (TOOL_NAMES.has(tool)) {
        intendedTool = tool;
        syncToolUi(tool);
      }
    }, true);

    window.addEventListener('pointermove', event => {
      if ((event.buttons & 1) !== 0) {
        if (leftPointerDown) lastPointer = { pointerId: event.pointerId, pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY };
        return;
      }
      const stuckRect = selectionRectVisible();
      if (leftPointerDown || stuckRect) {
        leftPointerDown = false;
        if (stuckRect) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        forceLegacyPointerRelease(event);
      } else {
        hideSelectionRect();
        releaseStuckTransform();
      }
    }, true);

    const released = event => {
      leftPointerDown = false;
      lastPointer = event ? { pointerId: event.pointerId, pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY } : lastPointer;
      hideSelectionRect();
      queueMicrotask(releaseStuckTransform);
    };
    window.addEventListener('pointerup', released, true);
    window.addEventListener('pointercancel', released, true);
    window.addEventListener('mouseup', released, true);
    window.addEventListener('blur', () => { released(); scheduleFocusPaint(); }, true);
    window.addEventListener('focus', scheduleFocusPaint, true);
    window.addEventListener('pageshow', scheduleFocusPaint, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleFocusPaint(); }, true);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && customPartPick) {
        customPartPick = null;
        document.querySelectorAll('.eph-part-pick-v62').forEach(item => item.classList.remove('armed'));
      }
    }, true);
  }

  function installObservers() {
    const editor = document.getElementById('editorScreen');
    if (editor && editor.dataset.ephPolishV62Observer !== '1') {
      editor.dataset.ephPolishV62Observer = '1';
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          cleanViewportButtons();
          syncToolUi();
          decoratePartFields();
        });
      }).observe(editor, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }
  }

  function install() {
    ensureStyle();
    installEvents();
    installObservers();
    cleanViewportButtons();
    syncToolUi();
    decoratePartFields();
  }

  install();
  window.addEventListener('eph3d-ready', install);
  window.addEventListener('eph-runtime-ready', () => {
    install();
    scheduleFocusPaint();
  }, { once: true });

  window.EPH_EDITOR_POLISH_V62 = {
    install,
    syncToolUi,
    repaint: scheduleFocusPaint,
    decoratePartFields,
    hideSelectionRect,
  };

  console.info('[Editor Polish V62] Focus repaint, smooth tool UI authority, stuck marquee recovery, Part reference picking, viewport cleanup and chat placement installed.');
})();