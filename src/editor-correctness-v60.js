// byanca
(() => {
  'use strict';
  if (window.__ephEditorCorrectnessV60) return;
  window.__ephEditorCorrectnessV60 = true;

  const VMAP = window.EPH_VMAP;
  const THREE = () => window.EPH_THREE || window.THREE;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewportNow = () => window.EPH3D || state()?.viewport || null;
  const objectById = id => state()?.objects?.find(object => object?.id === id) || null;
  const EPSILON_SQ = 1e-10;

  let negativeScalePairs = [];
  let groupMove = null;

  function stripCollidingProperty() {
    const host = document.getElementById('propertiesContent');
    if (!host) return false;

    const exact = host.querySelector('[data-toggle="collision"]');
    exact?.closest?.('.toggle-row')?.remove?.();

    for (const row of host.querySelectorAll('.toggle-row')) {
      const text = String(row.textContent || '').trim();
      if (/^Colliding\b/i.test(text)) row.remove();
    }

    for (const title of host.querySelectorAll('.property-section-title')) {
      if (String(title.textContent || '').trim() === 'Collision / Gameplay') title.textContent = 'Gameplay';
    }

    const note = host.querySelector('.eph-collision-export-note-v25');
    if (note) note.textContent = 'Player / Grenade / Bullet blockers export matching Hammer tool-volume meshes when the VMAP is saved.';
    return true;
  }

  function installPropertyCleanup() {
    stripCollidingProperty();
    if (typeof renderProperties === 'function' && !renderProperties.__ephV60NoColliding) {
      const previous = renderProperties;
      const wrapped = function(...args) {
        const result = previous.apply(this, args);
        stripCollidingProperty();
        return result;
      };
      for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
      wrapped.__ephV60NoColliding = true;
      wrapped.__ephPrevious = previous;
      try { renderProperties = wrapped; } catch {}
      window.renderProperties = wrapped;
    }

    const host = document.getElementById('propertiesContent');
    if (host && host.dataset.ephV60NoColliding !== '1') {
      host.dataset.ephV60NoColliding = '1';
      new MutationObserver(stripCollidingProperty).observe(host, { childList: true, subtree: true });
    }
  }

  function forceHistoryInstall() {
    const history = window.EPH_LOCAL_HISTORY;
    if (!history?.install || history.active?.()) return Boolean(history?.active?.());

    let dirty = null;
    try { if (typeof markDirty === 'function') dirty = markDirty; } catch {}
    dirty ||= window.markDirty;
    if (typeof dirty !== 'function') return false;

    const originalCollab = window.EPH_COLLAB;
    const suppliedCollab = !originalCollab;
    const hadMarker = Object.prototype.hasOwnProperty.call(dirty, '__ephCollaboration');
    const oldMarker = dirty.__ephCollaboration;

    try {
      if (suppliedCollab) window.EPH_COLLAB = { ephHistoryInstallOnly: true };
      dirty.__ephCollaboration = true;
      history.install();
    } catch (error) {
      console.warn('[Editor Correctness V60] Could not activate local history.', error);
    } finally {
      if (hadMarker) dirty.__ephCollaboration = oldMarker;
      else {
        try { delete dirty.__ephCollaboration; } catch {}
      }
      if (suppliedCollab) {
        try { delete window.EPH_COLLAB; } catch { window.EPH_COLLAB = originalCollab; }
      }
    }
    return Boolean(history.active?.());
  }

  function performHistory(action) {
    const history = window.EPH_LOCAL_HISTORY;
    if (history?.active?.() && typeof history[action] === 'function') {
      history[action]();
      return true;
    }
    const fallback = window[action];
    if (typeof fallback === 'function') {
      fallback();
      return true;
    }
    return false;
  }

  function installHistoryControls() {
    forceHistoryInstall();
    if (document.documentElement.dataset.ephV60HistoryControls === '1') return;
    document.documentElement.dataset.ephV60HistoryControls = '1';

    document.addEventListener('click', event => {
      const target = event.target?.closest?.('#toolbarUndo, #toolbarRedo, [data-action="undo"], [data-action="redo"]');
      if (!target) return;
      const action = target.id === 'toolbarRedo' || target.dataset?.action === 'redo' ? 'redo' : 'undo';
      event.preventDefault();
      event.stopImmediatePropagation();
      performHistory(action);
    }, true);

    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const active = document.activeElement;
      if (active?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName)) return;
      const key = String(event.key || '').toLowerCase();
      let action = null;
      if (key === 'z') action = event.shiftKey ? 'redo' : 'undo';
      else if (key === 'y') action = 'redo';
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      performHistory(action);
    }, true);
  }

  function fullyVisible(node, stop) {
    for (let current = node; current; current = current.parent) {
      if (current.visible === false) return false;
      if (current === stop) break;
    }
    return true;
  }

  function materialVisible(material) {
    const list = Array.isArray(material) ? material : [material];
    return list.some(item => item && item.visible !== false && (item.opacity == null || item.opacity > 0.03));
  }

  function disposeNegativeScaleLines() {
    for (const pair of negativeScalePairs.splice(0)) pair.clone?.parent?.remove?.(pair.clone);
  }

  function discoverNegativeScaleLines(vp) {
    if (!vp?.transform || String(vp.transform.mode || '').toLowerCase() !== 'scale') return;
    const helper = vp.transform.getHelper?.();
    if (!helper) return;

    negativeScalePairs = negativeScalePairs.filter(pair => {
      if (pair.source?.parent && pair.clone?.parent) return true;
      pair.clone?.parent?.remove?.(pair.clone);
      return false;
    });

    const existingSources = new Set(negativeScalePairs.map(pair => pair.source));
    const candidates = [];
    helper.traverse?.(node => {
      if (node?.userData?.ephNegativeScaleLineV60) return;
      if (!(node?.isLine || node?.isLineSegments)) return;
      if (!['X', 'Y', 'Z'].includes(String(node.name || '').toUpperCase())) return;
      if (!fullyVisible(node, helper) || !materialVisible(node.material)) return;
      if (existingSources.has(node)) return;
      candidates.push(node);
    });

    for (const source of candidates) {
      const clone = source.clone(false);
      clone.name = `EPH_NegativeScaleLineV60_${String(source.name || '').toUpperCase()}`;
      clone.userData ||= {};
      clone.userData.ephNegativeScaleLineV60 = true;
      clone.userData.ephTransformGizmo = true;
      clone.raycast = () => {};
      source.parent?.add?.(clone);
      negativeScalePairs.push({ source, clone });
    }
  }

  function updateNegativeScaleLines(vp = viewportNow()) {
    if (!vp?.transform) return;
    const mode = String(vp.transform.mode || '').toLowerCase();
    if (mode === 'scale') discoverNegativeScaleLines(vp);

    for (const pair of negativeScalePairs) {
      const { source, clone } = pair;
      if (!source?.parent || !clone?.parent) continue;
      clone.visible = source.visible !== false && mode === 'scale';
      if (!clone.visible) continue;
      clone.position.copy(source.position).multiplyScalar(-1);
      clone.quaternion.copy(source.quaternion);
      clone.scale.copy(source.scale).multiplyScalar(-1);
      clone.renderOrder = source.renderOrder;
    }
  }

  function selectedIds(vp = viewportNow()) {
    const result = [];
    const add = id => {
      if (!id || result.includes(id)) return;
      const object = objectById(id);
      if (!object || ['world', 'folder'].includes(object.type) || object.visible === false) return;
      result.push(id);
    };
    try { for (const id of window.EPH_MULTI_SELECTION?.ids?.() || []) add(id); } catch {}
    for (const id of state()?.multiSelectedIds || []) add(id);
    for (const id of vp?.multiSelectedIds || []) add(id);
    add(state()?.selectedId);
    add(vp?.selectedId);
    return result;
  }

  function physicalRoots(vp, logicalId) {
    const object = objectById(logicalId);
    if (!object || !vp?.objectRoots) return [];

    if (['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length)) {
      const childIds = new Set(object.ephMeshChildIds || []);
      for (const candidate of state()?.objects || []) {
        if (candidate?.type === 'part' && candidate.parent === object.id) childIds.add(candidate.id);
      }
      const children = [...childIds]
        .map(id => ({ objectId: id, root: vp.objectRoots.get(id) }))
        .filter(item => item.root?.visible !== false);
      if (children.length) return children;
    }

    const root = vp.objectRoots.get(logicalId);
    return root ? [{ objectId: logicalId, root }] : [];
  }

  function ensureMultiMoveAttachment(vp = viewportNow()) {
    if (!vp?.transform || vp.transform.dragging || vp.tool !== 'move') return false;
    const ids = selectedIds(vp);
    if (ids.length <= 1 || vp.transform.object) return false;

    try { window.EPH_MESH_ENTITY_TRANSFORM_V31?.attach?.(); } catch {}
    if (vp.transform.object) return true;

    const primary = vp.selectedId || state()?.selectedId || ids.at(-1);
    const root = physicalRoots(vp, primary)[0]?.root;
    if (!root) return false;
    if (typeof vp.attachObjectTransform === 'function') vp.attachObjectTransform(root);
    else {
      vp.transform.attach?.(root);
      vp.transform.setMode?.('translate');
    }
    return true;
  }

  function syncPhysicalObject(record, commit = false) {
    const s = state();
    const vp = viewportNow();
    const object = objectById(record.objectId);
    const root = record.root;
    if (!s?.doc || !object || !root) return;
    object.position = [root.position.x, root.position.y, root.position.z];
    VMAP?.applyObjectToDocument?.(s.doc, object);
    vp?.callbacks?.change?.(object, commit);
  }

  function beginGroupMove(vp) {
    groupMove = null;
    if (!vp?.transform || vp.tool !== 'move') return;
    const ids = selectedIds(vp);
    if (ids.length <= 1) return;

    const primaryId = vp.selectedId || state()?.selectedId || ids.at(-1);
    const primaryRoot = vp.transform.object || physicalRoots(vp, primaryId)[0]?.root;
    if (!primaryRoot) return;

    const entries = [];
    for (const id of ids) {
      if (id === primaryId) continue;
      for (const record of physicalRoots(vp, id)) {
        if (!record.root || record.root === primaryRoot) continue;
        entries.push({
          logicalId: id,
          objectId: record.objectId,
          root: record.root,
          start: record.root.position.clone(),
        });
      }
    }
    if (!entries.length) return;

    groupMove = {
      vp,
      primaryId,
      primaryRoot,
      primaryStart: primaryRoot.position.clone(),
      entries,
      corrected: false,
      changed: new Set(),
    };
  }

  function updateGroupMove() {
    const session = groupMove;
    if (!session || session.vp?.tool !== 'move' || session.vp.transform?.object !== session.primaryRoot) return;
    const delta = session.primaryRoot.position.clone().sub(session.primaryStart);

    for (const entry of session.entries) {
      if (!entry.root?.parent) continue;
      const expected = entry.start.clone().add(delta);
      if (entry.root.position.distanceToSquared(expected) <= EPSILON_SQ) continue;
      entry.root.position.copy(expected);
      entry.root.updateMatrixWorld?.(true);
      session.corrected = true;
      session.changed.add(entry.objectId);
      syncPhysicalObject(entry, false);
    }
    if (session.corrected) session.vp.updateSelectionBox?.();
  }

  function finishGroupMove() {
    const session = groupMove;
    groupMove = null;
    if (!session?.corrected) return;

    for (const id of session.changed) {
      const record = session.entries.find(entry => entry.objectId === id);
      if (record) syncPhysicalObject(record, true);
    }
    try { renderProperties?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('eph-selection-changed', { detail: { ids: selectedIds(session.vp), primary: state()?.selectedId || null } })); } catch {}
  }

  function installMultiMove(vp = viewportNow()) {
    if (!vp?.transform || vp.__ephGroupMoveV60) return false;
    vp.__ephGroupMoveV60 = true;
    vp.transform.addEventListener('dragging-changed', event => {
      if (event.value) beginGroupMove(vp);
      else finishGroupMove();
    });
    vp.transform.addEventListener('objectChange', updateGroupMove);
    window.addEventListener('eph-selection-changed', () => ensureMultiMoveAttachment(vp));
    return true;
  }

  function install(vp = viewportNow()) {
    installPropertyCleanup();
    installHistoryControls();
    installMultiMove(vp);
    ensureMultiMoveAttachment(vp);
    updateNegativeScaleLines(vp);
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    install();
    stripCollidingProperty();
    if (checks >= 60) clearInterval(guard);
  }, 100);

  const scaleLoop = () => {
    updateNegativeScaleLines();
    requestAnimationFrame(scaleLoop);
  };
  requestAnimationFrame(scaleLoop);

  window.EPH_EDITOR_CORRECTNESS_V60 = {
    install,
    stripCollidingProperty,
    forceHistoryInstall,
    ensureMultiMoveAttachment,
    updateNegativeScaleLines,
  };

  console.info('[Editor Correctness V60] Colliding UI removed, undo/redo activated offline, negative scale rails mirrored from TransformControls, and multi-selection Move repaired.');
})();
