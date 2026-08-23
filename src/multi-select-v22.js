// byanca
(() => {
  'use strict';
  if (window.__ephMultiSelectV22) return;
  window.__ephMultiSelectV22 = true;

  let selection = new Set();
  let anchorId = null;
  let viewport = null;
  let helpers = [];
  let multiDrag = null;
  let renderTreeWrapped = null;
  let renderPropertiesWrapped = null;
  const DEG = 180 / Math.PI;

  const idsEqual = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const currentIds = () => [...selection];

  function selectable(id) {
    const object = S?.objects?.find(item => item.id === id);
    return Boolean(object && !['world', 'folder'].includes(object.type));
  }

  function clearHelpers() {
    if (!viewport) return;
    for (const helper of helpers.splice(0)) {
      viewport.scene?.remove?.(helper);
      helper.geometry?.dispose?.();
      helper.material?.dispose?.();
    }
  }

  function refreshHelpers() {
    clearHelpers();
    if (!viewport || selection.size <= 1) return;
    const THREE = window.EPH_THREE || window.THREE;
    if (!THREE?.BoxHelper) return;
    for (const id of selection) {
      if (id === S.selectedId) continue;
      const root = viewport.objectRoots?.get?.(id);
      if (!root) continue;
      const helper = new THREE.BoxHelper(root, 0x7fb7ff);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.9;
      helper.renderOrder = 998;
      helper.userData.ephMultiSelection = true;
      viewport.scene.add(helper);
      helpers.push(helper);
    }
  }

  function visibleTreeObjects() {
    const query = String(document.getElementById('sceneSearch')?.value || '').trim().toLowerCase();
    const objects = S?.objects || [];
    const result = [];
    // The old implementation called objects.filter() once for every object,
    // making a 3,800-object Anubis tree roughly O(n²) on every selection. Build
    // the hierarchy index once so annotation/range selection stays O(n).
    const byParent = new Map();
    for (const object of objects) {
      const key = object.parent == null ? null : object.parent;
      let list = byParent.get(key);
      if (!list) { list = []; byParent.set(key, list); }
      list.push(object);
    }
    const children = id => byParent.get(id) || [];
    const include = object => {
      const kids = children(object.id);
      return !query || String(object.name || '').toLowerCase().includes(query) || kids.some(child => String(child.name || '').toLowerCase().includes(query));
    };
    const walk = object => {
      if (!include(object)) return;
      result.push(object);
      if (object.expanded) for (const child of children(object.id)) walk(child);
    };
    for (const object of byParent.get(null) || []) walk(object);
    return result;
  }

  function annotateTree() {
    const tree = document.getElementById('sceneTree');
    if (!tree) return;
    const objects = visibleTreeObjects();
    const rows = [...tree.querySelectorAll('.tree-row')];
    rows.forEach((row, index) => {
      const object = objects[index];
      if (!object) return;
      row.dataset.objectId = object.id;
      row.classList.toggle('eph-multi-selected', selection.has(object.id));
      row.classList.toggle('eph-multi-primary', object.id === S.selectedId && selection.has(object.id));
    });
  }

  function renderSelectionInfo() {
    if (selection.size <= 1) return;
    const host = document.getElementById('propertiesContent');
    if (!host || host.querySelector('.eph-multi-selection-info')) return;
    const bar = document.createElement('div');
    bar.className = 'eph-multi-selection-info';
    bar.textContent = `${selection.size} objects selected`;
    host.prepend(bar);
  }

  function setSelection(ids, primary = null, options = {}) {
    const filtered = [...new Set((ids || []).filter(selectable))];
    if (!filtered.length && primary && selectable(primary)) filtered.push(primary);
    selection = new Set(filtered);
    primary = selectable(primary) && selection.has(primary) ? primary : filtered.at(-1) || null;
    if (primary) S.selectedId = primary;
    S.multiSelectedIds = [...selection];
    S.selectedFaces = new Set([0]);
    S.subSelection = null;

    const vp = viewport || S?.viewport || window.EPH3D;
    if (vp) {
      if (primary && options.selectViewport !== false) vp.select?.(primary, false);
      vp.multiSelectedIds = [...selection];
      vp.selectedId = primary || vp.selectedId;
      vp.updateSelectionBox?.();
    }

    if (primary) anchorId = primary;
    refreshHelpers();
    annotateTree();
    if (options.render !== false) {
      try { renderProperties?.(); } catch {}
      renderSelectionInfo();
    }
    return [...selection];
  }

  function toggleSelection(id) {
    if (!selectable(id)) return;
    const ids = currentIds();
    if (selection.has(id)) {
      const next = ids.filter(value => value !== id);
      setSelection(next, next.at(-1) || null);
    } else setSelection([...ids, id], id);
  }

  function rangeSelection(id) {
    const objects = visibleTreeObjects().filter(object => selectable(object.id));
    const ids = objects.map(object => object.id);
    const target = ids.indexOf(id);
    const anchor = ids.indexOf(anchorId);
    if (target < 0 || anchor < 0) return toggleSelection(id);
    const low = Math.min(target, anchor), high = Math.max(target, anchor);
    setSelection(ids.slice(low, high + 1), id);
  }

  function installTree() {
    const tree = document.getElementById('sceneTree');
    if (!tree || tree.dataset.ephMultiV22 === '1') return Boolean(tree);
    tree.dataset.ephMultiV22 = '1';

    tree.addEventListener('click', event => {
      const row = event.target.closest('.tree-row');
      if (!row || event.target.closest('.tree-eye, .tree-chevron')) return;
      const id = row.dataset.objectId;
      if (!id || !selectable(id)) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.shiftKey) rangeSelection(id);
        else toggleSelection(id);
        return;
      }
      setTimeout(() => setSelection([S.selectedId], S.selectedId, { selectViewport: false }), 0);
    }, true);

    new MutationObserver(() => annotateTree()).observe(tree, { childList: true, subtree: true });
    annotateTree();
    return true;
  }

  function hitObject(event) {
    if (!viewport?.renderer?.domElement) return null;
    const canvas = viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    viewport.pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    viewport.pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
    const hits = viewport.raycaster.intersectObjects([...viewport.objectRoots.values()], true);
    for (const hit of hits) {
      let root = hit.object;
      while (root.parent && root.parent !== viewport.objectGroup) root = root.parent;
      if (selectable(root.userData?.ephId)) return root.userData.ephId;
    }
    return null;
  }

  function syncObjectFromRoot(id, commit = false) {
    const object = S.objects.find(item => item.id === id);
    const root = viewport?.objectRoots?.get?.(id);
    if (!object || !root) return;
    object.position = [root.position.x, root.position.y, root.position.z];
    object.rotation = [root.rotation.x * DEG, root.rotation.y * DEG, root.rotation.z * DEG];
    object.scale = [root.scale.x, root.scale.y, root.scale.z];
    VMAP.applyObjectToDocument?.(S.doc, object);
    viewport.callbacks?.change?.(object, commit);
  }

  function beginMultiTransform() {
    if (!viewport || selection.size <= 1 || !selection.has(viewport.selectedId)) return;
    if (!['move', 'rotate'].includes(viewport.tool)) return;
    const THREE = window.EPH_THREE || window.THREE;
    const primary = viewport.objectRoots.get(viewport.selectedId);
    if (!primary || !THREE) return;
    multiDrag = {
      tool: viewport.tool,
      primaryId: viewport.selectedId,
      primaryPosition: primary.position.clone(),
      primaryQuaternion: primary.quaternion.clone(),
      others: [...selection].filter(id => id !== viewport.selectedId).map(id => {
        const root = viewport.objectRoots.get(id);
        return root ? { id, position: root.position.clone(), quaternion: root.quaternion.clone(), scale: root.scale.clone() } : null;
      }).filter(Boolean),
      THREE,
    };
  }

  function updateMultiTransform() {
    if (!multiDrag || !viewport) return;
    const primary = viewport.objectRoots.get(multiDrag.primaryId);
    if (!primary) return;
    const THREE = multiDrag.THREE;
    if (multiDrag.tool === 'move') {
      const delta = primary.position.clone().sub(multiDrag.primaryPosition);
      for (const item of multiDrag.others) {
        const root = viewport.objectRoots.get(item.id);
        if (!root) continue;
        root.position.copy(item.position).add(delta);
        syncObjectFromRoot(item.id, false);
      }
    } else if (multiDrag.tool === 'rotate') {
      const inverse = multiDrag.primaryQuaternion.clone().invert();
      const deltaQuaternion = primary.quaternion.clone().multiply(inverse);
      for (const item of multiDrag.others) {
        const root = viewport.objectRoots.get(item.id);
        if (!root) continue;
        const offset = item.position.clone().sub(multiDrag.primaryPosition).applyQuaternion(deltaQuaternion);
        root.position.copy(multiDrag.primaryPosition).add(offset);
        root.quaternion.copy(deltaQuaternion.clone().multiply(item.quaternion));
        syncObjectFromRoot(item.id, false);
      }
    }
    for (const helper of helpers) helper.update?.();
  }

  function finishMultiTransform() {
    if (!multiDrag || !viewport) return;
    const items = multiDrag.others;
    multiDrag = null;
    for (const item of items) syncObjectFromRoot(item.id, true);
    refreshHelpers();
  }

  function installViewport() {
    const vp = S?.viewport || window.EPH3D;
    if (!vp?.renderer?.domElement) return false;
    viewport = vp;
    if (vp.__ephMultiSelectV22) return true;
    vp.__ephMultiSelectV22 = true;

    const canvas = vp.renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
      if (!(event.ctrlKey || event.metaKey || event.shiftKey) || event.button !== 0) return;
      if (vp.transform?.dragging || vp.transform?.axis) return;
      const id = hitObject(event);
      if (!id) return;
      const before = currentIds();
      event.preventDefault();
      event.stopImmediatePropagation();
      const apply = () => {
        selection = new Set(before.filter(selectable));
        if (event.shiftKey || event.ctrlKey || event.metaKey) toggleSelection(id);
      };
      apply();
      setTimeout(apply, 0);
    }, true);

    canvas.addEventListener('pointerup', event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      setTimeout(() => {
        const fromViewport = Array.isArray(vp.multiSelectedIds) ? vp.multiSelectedIds.filter(selectable) : [];
        if (fromViewport.length > 1) setSelection(fromViewport, vp.selectedId || fromViewport[0], { selectViewport: false });
        else if (selectable(S.selectedId)) setSelection([S.selectedId], S.selectedId, { selectViewport: false });
      }, 0);
    }, true);

    vp.transform.addEventListener('dragging-changed', event => {
      if (event.value) beginMultiTransform();
      else finishMultiTransform();
    });
    vp.transform.addEventListener('objectChange', updateMultiTransform);

    const originalSetObjects = vp.setObjects.bind(vp);
    vp.setObjects = function(objects, selectedId = null) {
      const result = originalSetObjects(objects, selectedId);
      queueMicrotask(() => {
        const kept = currentIds().filter(id => objects.some(object => object.id === id));
        if (kept.length) setSelection(kept, kept.includes(selectedId) ? selectedId : kept.at(-1), { selectViewport: false, render: false });
        else if (selectable(selectedId)) setSelection([selectedId], selectedId, { selectViewport: false, render: false });
      });
      return result;
    };

    if (selectable(S.selectedId)) setSelection([S.selectedId], S.selectedId, { selectViewport: false, render: false });
    return true;
  }

  function installRenderWrappers() {
    if (typeof renderTree === 'function' && !renderTree.__ephMultiV22) {
      const raw = renderTree;
      renderTree = function() {
        const result = raw();
        queueMicrotask(annotateTree);
        return result;
      };
      renderTree.__ephMultiV22 = true;
      renderTreeWrapped = renderTree;
      window.renderTree = renderTree;
    }
    if (typeof renderProperties === 'function' && !renderProperties.__ephMultiV22) {
      const raw = renderProperties;
      renderProperties = function() {
        const result = raw();
        renderSelectionInfo();
        return result;
      };
      renderProperties.__ephMultiV22 = true;
      renderPropertiesWrapped = renderProperties;
      window.renderProperties = renderProperties;
    }
  }

  function ensureStyle() {
    if (document.getElementById('ephMultiSelectV22Style')) return;
    const style = document.createElement('style');
    style.id = 'ephMultiSelectV22Style';
    style.textContent = `
      .tree-row.eph-multi-selected{background:rgba(65,125,190,.24)!important;box-shadow:inset 2px 0 rgba(105,175,245,.8)}
      .tree-row.eph-multi-primary{background:rgba(65,125,190,.38)!important}
      .eph-multi-selection-info{margin:0 0 8px;padding:7px 9px;border:1px solid #34506b;border-radius:4px;background:#101923;color:#b8d8f5;font-size:11px}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (typeof S === 'undefined' || !window.EPH_VMAP) return false;
    ensureStyle();
    installRenderWrappers();
    installTree();
    installViewport();
    return true;
  }

  window.EPH_MULTI_SELECTION = {
    set: setSelection,
    toggle: toggleSelection,
    ids: currentIds,
    clear: () => setSelection([], null),
    refresh: () => { annotateTree(); refreshHelpers(); },
  };

  install();
  // Settle only a few times while project-dialog finishes loading its wrappers.
  // The old 180 ms / 30 s poll was unnecessary startup work.
  [500, 1500, 3000].forEach(delay => setTimeout(() => {
    install();
    if (renderTreeWrapped && renderTree !== renderTreeWrapped) installRenderWrappers();
    if (renderPropertiesWrapped && renderProperties !== renderPropertiesWrapped) installRenderWrappers();
    const vp = S?.viewport || window.EPH3D;
    const viewportIds = Array.isArray(vp?.multiSelectedIds) ? vp.multiSelectedIds.filter(selectable) : [];
    if (viewportIds.length > 1 && !idsEqual(viewportIds, currentIds())) setSelection(viewportIds, vp.selectedId || viewportIds[0], { selectViewport: false, render: false });
  }, delay));
  window.addEventListener('eph3d-ready', installViewport);
})();
