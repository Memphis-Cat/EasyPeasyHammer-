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

  const currentIds = () => [...selection];
  const sameIds = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const objectFor = id => S?.objects?.find(item => item.id === id) || null;
  const selectable = id => {
    const object = objectFor(id);
    return Boolean(object && !['world', 'folder'].includes(object.type));
  };

  function emitSelectionChanged() {
    try {
      window.dispatchEvent(new CustomEvent('eph-selection-changed', {
        detail: { ids: currentIds(), primary: S?.selectedId ?? null }
      }));
    } catch {}
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
    if (!viewport || !selection.size) return;
    const THREE = window.EPH_THREE || window.THREE;
    if (!THREE?.BoxHelper) return;

    // Every selected object gets the same blue bounds. The yellow Hammer-style
    // overlay is handled by hammer-selection-v46. Previously the primary got
    // yellow while only the secondary objects got blue, which made one logical
    // selection look like two unrelated selection states.
    for (const id of selection) {
      const root = viewport.objectRoots?.get?.(id);
      if (!root?.visible) continue;
      const helper = new THREE.BoxHelper(root, 0x7fb7ff);
      helper.material.depthTest = false;
      helper.material.depthWrite = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.9;
      helper.renderOrder = 998;
      helper.userData.ephMultiSelection = true;
      helper.raycast = () => {};
      viewport.scene.add(helper);
      helpers.push(helper);
    }
  }

  function visibleTreeObjects() {
    const query = String(document.getElementById('sceneSearch')?.value || '').trim().toLowerCase();
    const objects = S?.objects || [];
    const result = [];
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
      return !query
        || String(object.name || '').toLowerCase().includes(query)
        || kids.some(child => String(child.name || '').toLowerCase().includes(query));
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
    const visible = visibleTreeObjects();
    const rows = [...tree.querySelectorAll('.tree-row')];

    rows.forEach((row, index) => {
      // Keep the id on the DOM row once it has been resolved. This avoids
      // selection jumping to a different row when another wrapper performs a
      // selection-only tree refresh without rebuilding the DOM.
      const fallback = visible[index] || null;
      if (!row.dataset.objectId && fallback?.id) row.dataset.objectId = fallback.id;
      const id = row.dataset.objectId || fallback?.id || '';
      const selected = Boolean(id && selection.has(id));
      const primary = Boolean(id && id === S?.selectedId);
      row.classList.toggle('selected', primary);
      row.classList.toggle('eph-multi-selected', selected);
      row.classList.toggle('eph-multi-primary', selected && primary);
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

  function syncViewportPrimary(vp, primary, shouldSelect) {
    if (!vp) return;
    vp.multiSelectedIds = currentIds();
    if (shouldSelect) {
      try { vp.select?.(primary, false); } catch { vp.selectedId = primary; }
      return;
    }
    vp.selectedId = primary;
    if (!primary) {
      try { vp.transform?.detach?.(); } catch {}
      if (vp.selectionBox) vp.selectionBox.visible = false;
    }
  }

  function finishUi(options = {}) {
    refreshHelpers();
    annotateTree();
    emitSelectionChanged();
    if (options.render !== false) {
      try { renderProperties?.(); } catch {}
      renderSelectionInfo();
    }
  }

  function setSelection(ids, primary = null, options = {}) {
    const filtered = [...new Set((ids || []).filter(selectable))];
    if (!filtered.length && primary && selectable(primary)) filtered.push(primary);
    primary = selectable(primary) && filtered.includes(primary) ? primary : filtered.at(-1) || null;

    selection = new Set(filtered);
    S.multiSelectedIds = [...selection];
    S.selectedId = primary;
    S.selectedFaces = primary ? new Set([0]) : new Set();
    S.subSelection = null;
    anchorId = primary || null;

    const vp = viewport || S?.viewport || window.EPH3D;
    syncViewportPrimary(vp, primary, options.selectViewport !== false);
    try { vp?.updateSelectionBox?.(); } catch {}
    finishUi(options);
    return currentIds();
  }

  function setPrimaryOnly(id, options = {}) {
    const object = objectFor(id);
    const primary = object ? id : null;
    selection = new Set();
    S.multiSelectedIds = [];
    S.selectedId = primary;
    S.selectedFaces = primary ? new Set([0]) : new Set();
    S.subSelection = null;
    anchorId = null;

    const vp = viewport || S?.viewport || window.EPH3D;
    syncViewportPrimary(vp, primary, options.selectViewport !== false);
    try { vp?.updateSelectionBox?.(); } catch {}
    finishUi(options);
    return [];
  }

  function toggleSelection(id) {
    if (!selectable(id)) return currentIds();
    const ids = currentIds();
    if (selection.has(id)) {
      const next = ids.filter(value => value !== id);
      return setSelection(next, next.at(-1) || null);
    }
    return setSelection([...ids, id], id);
  }

  function rangeSelection(id) {
    if (!selectable(id)) return currentIds();
    const objects = visibleTreeObjects().filter(object => selectable(object.id));
    const ids = objects.map(object => object.id);
    const target = ids.indexOf(id);
    const anchor = ids.indexOf(anchorId);
    if (target < 0 || anchor < 0) return toggleSelection(id);
    const low = Math.min(target, anchor);
    const high = Math.max(target, anchor);
    return setSelection(ids.slice(low, high + 1), id);
  }

  function installTree() {
    const tree = document.getElementById('sceneTree');
    if (!tree || tree.dataset.ephMultiV22 === '1') return Boolean(tree);
    tree.dataset.ephMultiV22 = '1';

    // One authoritative Scene-tree selection path. The old version allowed the
    // base row onclick to run and then repaired selection in a setTimeout. That
    // created a visible frame where primary, multi-selection and yellow overlay
    // all referred to different objects.
    tree.addEventListener('click', event => {
      const row = event.target.closest('.tree-row');
      if (!row || event.target.closest('.tree-eye, .tree-chevron')) return;
      const id = row.dataset.objectId || visibleTreeObjects()[[...tree.querySelectorAll('.tree-row')].indexOf(row)]?.id;
      if (!id || !objectFor(id)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey && selectable(id)) rangeSelection(id);
      else if ((event.ctrlKey || event.metaKey) && selectable(id)) toggleSelection(id);
      else if (selectable(id)) setSelection([id], id);
      else setPrimaryOnly(id);
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
    emitSelectionChanged();
  }

  function reconcileAfterSetObjects(objects, selectedId) {
    const objectIds = new Set((objects || []).map(object => object?.id).filter(Boolean));
    const kept = currentIds().filter(id => objectIds.has(id) && selectable(id));
    const selectedObject = selectedId ? objectFor(selectedId) : null;

    if (selectedObject && selectable(selectedId)) {
      // If setObjects explicitly selected a new object (new part, duplicate,
      // placed entity, map switch), that explicit selection wins over the old
      // multi-selection. If it is already part of the multi-selection, preserve
      // the group and merely make it primary.
      if (kept.includes(selectedId)) setSelection(kept, selectedId, { selectViewport: false, render: false });
      else setSelection([selectedId], selectedId, { selectViewport: false, render: false });
    } else if (selectedObject) {
      setPrimaryOnly(selectedId, { selectViewport: false, render: false });
    } else {
      setSelection([], null, { selectViewport: false, render: false });
    }
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
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey || event.ctrlKey || event.metaKey) toggleSelection(id);
    }, true);

    canvas.addEventListener('pointerup', event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      queueMicrotask(() => {
        const primary = vp.selectedId || S.selectedId || null;
        const fromViewport = Array.isArray(vp.multiSelectedIds) ? vp.multiSelectedIds.filter(selectable) : [];
        if (fromViewport.length > 1 && primary && fromViewport.includes(primary)) {
          if (!sameIds(fromViewport, currentIds()) || S.selectedId !== primary)
            setSelection(fromViewport, primary, { selectViewport: false });
        } else if (selectable(primary)) {
          if (selection.size !== 1 || !selection.has(primary) || S.selectedId !== primary)
            setSelection([primary], primary, { selectViewport: false });
        } else if (primary && objectFor(primary)) {
          if (selection.size || S.selectedId !== primary) setPrimaryOnly(primary, { selectViewport: false });
        } else if (selection.size || S.selectedId) {
          setSelection([], null, { selectViewport: false });
        }
      });
    }, true);

    vp.transform.addEventListener('dragging-changed', event => {
      if (event.value) beginMultiTransform();
      else finishMultiTransform();
    });
    vp.transform.addEventListener('objectChange', updateMultiTransform);

    const originalSetObjects = vp.setObjects.bind(vp);
    vp.setObjects = function(objects, selectedId = null) {
      const result = originalSetObjects(objects, selectedId);
      queueMicrotask(() => reconcileAfterSetObjects(objects, selectedId));
      return result;
    };

    if (selectable(S.selectedId)) setSelection([S.selectedId], S.selectedId, { selectViewport: false, render: false });
    else if (S.selectedId && objectFor(S.selectedId)) setPrimaryOnly(S.selectedId, { selectViewport: false, render: false });
    else setSelection([], null, { selectViewport: false, render: false });
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
      .tree-row.eph-multi-selected{background:rgba(65,125,190,.30)!important;box-shadow:inset 2px 0 rgba(105,175,245,.9)}
      .tree-row.eph-multi-primary{background:rgba(65,125,190,.42)!important}
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
    setPrimaryOnly,
    toggle: toggleSelection,
    ids: currentIds,
    clear: () => setSelection([], null),
    refresh: () => { annotateTree(); refreshHelpers(); },
  };

  install();
  [500, 1500, 3000].forEach(delay => setTimeout(() => {
    install();
    if (renderTreeWrapped && renderTree !== renderTreeWrapped) installRenderWrappers();
    if (renderPropertiesWrapped && renderProperties !== renderPropertiesWrapped) installRenderWrappers();
    const vp = S?.viewport || window.EPH3D;
    const viewportIds = Array.isArray(vp?.multiSelectedIds) ? vp.multiSelectedIds.filter(selectable) : [];
    if (viewportIds.length > 1 && (!sameIds(viewportIds, currentIds()) || vp.selectedId !== S.selectedId))
      setSelection(viewportIds, vp.selectedId || viewportIds[0], { selectViewport: false, render: false });
  }, delay));
  window.addEventListener('eph3d-ready', installViewport);
})();
