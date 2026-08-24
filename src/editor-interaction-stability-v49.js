// byanca
(() => {
  'use strict';
  if (window.__ephEditorInteractionStabilityV49) return;
  window.__ephEditorInteractionStabilityV49 = true;

  const OBJECT_TOOLS = new Set(['select', 'move', 'rotate', 'scale']);
  const BLUE = 0x7fb7ff;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewport = () => window.EPH3D || state()?.viewport || null;
  const THREE = () => window.EPH_THREE || window.THREE;
  const objectFor = id => state()?.objects?.find(object => object?.id === id) || null;

  const blueHelpers = new Map();
  let blueFrame = 0;
  let treeFrame = 0;
  let toolbarFrame = 0;
  let voidPress = null;
  let treeObserver = null;
  let toolbarObserver = null;
  let installedViewport = null;

  function ensureStyle() {
    if (document.getElementById('ephInteractionStabilityV49Style')) return;
    const style = document.createElement('style');
    style.id = 'ephInteractionStabilityV49Style';
    style.textContent = `
      #sceneTree .tree-row.eph-negative-part-row .tree-name,
      #sceneTree .tree-row.eph-negative-part-row.selected .tree-name,
      #sceneTree .tree-row.eph-negative-part-row.eph-multi-selected .tree-name,
      #sceneTree .tree-row.eph-negative-part-row.eph-multi-primary .tree-name{
        color:#ff7b84!important;
      }
      .toolbar-row{
        min-height:42px!important;
        height:auto!important;
        overflow:visible!important;
        align-content:center!important;
      }
      .toolbar-row>.toolbar-group,
      .toolbar-row .mode-group,
      .toolbar-row .tool-mode,
      .toolbar-row .toolbar-dropdown,
      .toolbar-row .rotate-options,
      .toolbar-row .eph-transform-option,
      .toolbar-row #ephScaleV21{
        flex:0 0 auto!important;
      }
      .toolbar-row .tool-mode[data-tool]{
        display:inline-flex!important;
        visibility:visible!important;
        flex-shrink:0!important;
      }
      @media (max-width:1500px){
        .toolbar-row{flex-wrap:wrap!important;row-gap:3px!important;padding-top:2px!important;padding-bottom:2px!important;}
        .toolbar-row .view-icons{display:none!important;}
      }
    `;
    document.head.appendChild(style);
  }

  function selectedIds() {
    const s = state();
    const vp = viewport();
    const result = [];
    const add = id => {
      if (!id || result.includes(id)) return;
      const object = objectFor(id);
      if (!object || ['world', 'folder'].includes(object.type) || object.visible === false) return;
      result.push(id);
    };
    try { for (const id of window.EPH_MULTI_SELECTION?.ids?.() || []) add(id); } catch {}
    for (const id of Array.isArray(s?.multiSelectedIds) ? s.multiSelectedIds : []) add(id);
    for (const id of Array.isArray(vp?.multiSelectedIds) ? vp.multiSelectedIds : []) add(id);
    add(s?.selectedId || vp?.selectedId);
    return result;
  }

  function disposeHelper(entry) {
    const helper = entry?.helper || entry;
    if (!helper) return;
    helper.parent?.remove?.(helper);
    helper.geometry?.dispose?.();
    helper.material?.dispose?.();
  }

  function removeLegacyBlueHelpers(vp) {
    if (!vp?.scene?.children) return;
    for (const child of [...vp.scene.children]) {
      if (!child?.userData?.ephMultiSelection || child.userData?.ephMultiSelectionV49) continue;
      disposeHelper(child);
    }
  }

  function syncBlueHelpersNow() {
    blueFrame = 0;
    const vp = viewport();
    const T = THREE();
    if (!vp?.scene || !vp?.objectRoots || !T?.BoxHelper) return;

    removeLegacyBlueHelpers(vp);
    const wanted = new Set(selectedIds());

    for (const [id, entry] of [...blueHelpers]) {
      const root = vp.objectRoots.get(id);
      if (!wanted.has(id) || !root?.visible || entry.root !== root || !entry.helper?.parent) {
        disposeHelper(entry);
        blueHelpers.delete(id);
      }
    }

    for (const id of wanted) {
      const root = vp.objectRoots.get(id);
      if (!root?.visible) continue;
      let entry = blueHelpers.get(id);
      if (!entry) {
        const helper = new T.BoxHelper(root, BLUE);
        helper.material.depthTest = false;
        helper.material.depthWrite = false;
        helper.material.transparent = true;
        helper.material.opacity = 0.92;
        helper.renderOrder = 10038;
        helper.userData.ephMultiSelection = true;
        helper.userData.ephMultiSelectionV49 = true;
        helper.raycast = () => {};
        vp.scene.add(helper);
        entry = { root, helper };
        blueHelpers.set(id, entry);
      }
      try { entry.helper.update?.(); } catch {}
      entry.helper.visible = true;
    }
  }

  function scheduleBlueHelpers() {
    if (blueFrame) return;
    blueFrame = requestAnimationFrame(syncBlueHelpersNow);
  }

  function clearBlueHelpers() {
    // Do not stop the application's animation machinery. A queued helper frame
    // is harmless: selection is already empty, so it becomes a no-op cleanup.
    for (const entry of blueHelpers.values()) disposeHelper(entry);
    blueHelpers.clear();
  }

  function visibleTreeObjects() {
    const s = state();
    if (!s) return [];
    const query = String(document.getElementById('sceneSearch')?.value || '').trim().toLowerCase();
    const byParent = new Map();
    for (const object of s.objects || []) {
      const parent = object.parent == null ? null : object.parent;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(object);
    }
    const children = id => byParent.get(id) || [];
    const include = object => {
      const kids = children(object.id);
      return !query || String(object.name || '').toLowerCase().includes(query)
        || kids.some(child => String(child.name || '').toLowerCase().includes(query));
    };
    const result = [];
    const walk = object => {
      if (!include(object)) return;
      result.push(object);
      if (object.expanded) for (const child of children(object.id)) walk(child);
    };
    for (const object of byParent.get(null) || []) walk(object);
    return result;
  }

  function syncSceneTreeNow() {
    treeFrame = 0;
    const s = state();
    const tree = document.getElementById('sceneTree');
    if (!s || !tree) return;
    const selected = new Set(selectedIds());
    const visible = visibleTreeObjects();
    const rows = [...tree.querySelectorAll('.tree-row')];

    rows.forEach((row, index) => {
      const object = visible[index] || null;
      if (object?.id) row.dataset.objectId = object.id;
      else delete row.dataset.objectId;
      const id = object?.id || '';
      const isSelected = Boolean(id && selected.has(id));
      const primary = Boolean(id && id === s.selectedId);
      row.classList.toggle('selected', primary);
      row.classList.toggle('eph-multi-selected', isSelected);
      row.classList.toggle('eph-multi-primary', isSelected && primary);
      row.classList.toggle('eph-negative-part-row', Boolean(object?.type === 'part' && object.ephNegative));
    });
  }

  function scheduleSceneTree() {
    if (treeFrame) return;
    treeFrame = requestAnimationFrame(syncSceneTreeNow);
  }

  function clearEverything() {
    const s = state();
    const vp = viewport();
    const multi = window.EPH_MULTI_SELECTION;

    if (multi?.clear) {
      try { multi.clear(); } catch {}
    } else {
      try { vp?.select?.(null, false); } catch {}
    }

    if (vp) {
      vp.selectedId = null;
      vp.multiSelectedIds = [];
      try { vp.transform?.detach?.(); } catch {}
      if (vp.selectionBox) vp.selectionBox.visible = false;
    }
    if (s) {
      s.selectedId = null;
      s.multiSelectedIds = [];
      s.selectedFaces = new Set();
      s.subSelection = null;
    }

    clearBlueHelpers();
    try { window.EPH_HAMMER_SELECTION_V46?.clear?.(); } catch {}
    try { renderTree?.(); renderProperties?.(); } catch {}
    scheduleSceneTree();
    try {
      window.dispatchEvent(new CustomEvent('eph-selection-changed', {
        detail: { ids: [], primary: null, reason: 'void' }
      }));
    } catch {}
  }

  function hitAt(event) {
    try { return window.EPH_SURFACE_MOVE_V39?.selectAt?.(event) || null; }
    catch { return null; }
  }

  function installVoidDeselection() {
    if (window.__ephVoidDeselectionV49) return;
    window.__ephVoidDeselectionV49 = true;

    window.addEventListener('pointerdown', event => {
      const vp = viewport();
      const canvas = vp?.renderer?.domElement;
      if (!canvas || event.button !== 0 || !(event.target === canvas || event.composedPath?.().includes(canvas))) return;
      if (!OBJECT_TOOLS.has(String(vp.tool || state()?.tool || '').toLowerCase())) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (vp.transform?.dragging || vp.transform?.axis) return;
      voidPress = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        wasVoid: !hitAt(event),
      };
    }, true);

    window.addEventListener('pointerup', event => {
      const press = voidPress;
      voidPress = null;
      if (!press || press.pointerId !== event.pointerId || event.button !== 0 || !press.wasVoid) return;
      const vp = viewport();
      const canvas = vp?.renderer?.domElement;
      if (!canvas || !(event.target === canvas || event.composedPath?.().includes(canvas))) return;
      if (!OBJECT_TOOLS.has(String(vp.tool || state()?.tool || '').toLowerCase())) return;
      if (vp.transform?.dragging || vp.transform?.axis) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) return;
      if (hitAt(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clearEverything();
    }, true);

    window.addEventListener('pointercancel', () => { voidPress = null; }, true);
  }

  function protectYellowDuringTransform() {
    const selection = window.EPH_HAMMER_SELECTION_V46;
    if (!selection?.clear || selection.clear.__ephTransformSafeV49) return;
    const rawClear = selection.clear;
    const wrapped = function(...args) {
      const vp = viewport();
      if (vp?.transform?.dragging && selectedIds().length) return false;
      return rawClear.apply(this, args);
    };
    wrapped.__ephTransformSafeV49 = true;
    wrapped.__ephPrevious = rawClear;
    selection.clear = wrapped;
  }

  function installMultiRefreshFastPath() {
    const multi = window.EPH_MULTI_SELECTION;
    if (!multi || multi.__ephFastRefreshV49) return;
    multi.__ephFastRefreshV49 = true;
    multi.updateHelpers = scheduleBlueHelpers;
    multi.refresh = () => {
      scheduleSceneTree();
      scheduleBlueHelpers();
    };
  }

  function syncToolbarNow() {
    toolbarFrame = 0;
    const row = document.querySelector('.toolbar-row');
    if (!row) return;
    for (const button of row.querySelectorAll('.tool-mode[data-tool]')) {
      if (button.style.display === 'none') button.style.removeProperty('display');
      if (button.style.visibility === 'hidden') button.style.removeProperty('visibility');
    }
  }

  function scheduleToolbar() {
    if (toolbarFrame) return;
    toolbarFrame = requestAnimationFrame(syncToolbarNow);
  }

  function installObservers() {
    const tree = document.getElementById('sceneTree');
    if (tree && !treeObserver) {
      treeObserver = new MutationObserver(scheduleSceneTree);
      treeObserver.observe(tree, { childList: true });
    }
    const toolbar = document.querySelector('.toolbar-row');
    if (toolbar && !toolbarObserver) {
      toolbarObserver = new MutationObserver(scheduleToolbar);
      // Child changes are sufficient. Watching class/style attributes caused a
      // feedback loop while transform controls were being updated.
      toolbarObserver.observe(toolbar, { childList: true, subtree: true });
    }
  }

  function installViewportEvents() {
    const vp = viewport();
    if (!vp?.transform || installedViewport === vp) return;
    installedViewport = vp;
    const update = scheduleBlueHelpers;
    vp.transform.addEventListener?.('objectChange', update);
    vp.transform.addEventListener?.('dragging-changed', event => {
      scheduleBlueHelpers();
      if (!event.value) queueMicrotask(() => window.EPH_HAMMER_SELECTION_V46?.rebuild?.(vp, false));
    });
  }

  function install() {
    ensureStyle();
    installVoidDeselection();
    protectYellowDuringTransform();
    installMultiRefreshFastPath();
    installObservers();
    installViewportEvents();
    scheduleSceneTree();
    scheduleBlueHelpers();
    scheduleToolbar();
    return true;
  }

  window.addEventListener('eph-selection-changed', () => {
    protectYellowDuringTransform();
    scheduleSceneTree();
    scheduleBlueHelpers();
  });
  window.addEventListener('eph3d-ready', () => queueMicrotask(install));
  window.addEventListener('resize', scheduleToolbar, { passive: true });

  install();
  setTimeout(install, 500);

  window.EPH_INTERACTION_STABILITY_V49 = {
    install,
    clearSelection: clearEverything,
    refreshSelection: () => { scheduleSceneTree(); scheduleBlueHelpers(); },
  };
  console.info('[Interaction Stability V49] Self-test-safe selection, lightweight helper updates, void deselection, negative names and toolbar integrity installed.');
})();
