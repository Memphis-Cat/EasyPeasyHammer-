// byanca
(() => {
  'use strict';
  if (window.__ephLocalHistoryV22) return;
  window.__ephLocalHistoryV22 = true;

  const VMAP = window.EPH_VMAP;
  const MAX_HISTORY = 80;
  let installed = false;
  let pending = null;
  let internal = false;
  let rawMarkDirty = null;

  const clone = value => {
    if (value === undefined) return undefined;
    try { return structuredClone(value); }
    catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
  };
  const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const encoded = value => {
    if (value === undefined) return '__EPH_UNDEFINED__';
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const equal = (a, b) => encoded(a) === encoded(b);

  function selectedIds() {
    const ids = new Set();
    for (const id of S?.multiSelectedIds || []) if (id) ids.add(id);
    for (const id of S?.viewport?.multiSelectedIds || []) if (id) ids.add(id);
    if (S?.selectedId) ids.add(S.selectedId);
    ids.delete('world');
    return [...ids];
  }

  function objectState(object) {
    if (!object) return null;
    const out = clone(object);
    if (out && typeof out === 'object') {
      delete out.__ephHistoryHash;
      delete out.__ephRuntime;
    }
    return out;
  }

  function captureStates() {
    const states = {};
    for (const object of S?.objects || []) {
      if (!object?.id) continue;
      states[object.id] = objectState(object);
    }
    return states;
  }

  function rawElement(id) {
    const object = S?.objects?.find(item => item.id === id);
    if (!object?.dmxId || !S?.doc) return null;
    return clone(VMAP?.findElementByDmxId?.(S.doc, object.dmxId) || null);
  }

  function captureRaw(ids) {
    const out = {};
    for (const id of ids || []) {
      const raw = rawElement(id);
      if (raw) out[id] = raw;
    }
    return out;
  }

  function captureSelection() {
    return {
      ids: selectedIds(),
      primary: S?.selectedId || null,
      faces: [...(S?.selectedFaces || [])],
    };
  }

  function changedIds(before, after) {
    const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    return [...ids].filter(id => !equal(before?.[id], after?.[id]));
  }

  function finalize(entry = pending) {
    if (!entry || !entry.pending) return entry;
    if (!S.undo.includes(entry)) {
      if (pending === entry) pending = null;
      return null;
    }
    const afterAll = captureStates();
    const ids = changedIds(entry.beforeAll, afterAll);
    if (!ids.length) {
      const index = S.undo.indexOf(entry);
      if (index >= 0) S.undo.splice(index, 1);
      if (pending === entry) pending = null;
      return null;
    }
    entry.ids = ids;
    entry.before = Object.fromEntries(ids.map(id => [id, entry.beforeAll[id] ?? null]));
    entry.after = Object.fromEntries(ids.map(id => [id, afterAll[id] ?? null]));
    entry.afterRaw = captureRaw(ids.filter(id => entry.after[id]?.dmxId));
    entry.afterSelection = captureSelection();
    entry.pending = false;
    delete entry.beforeAll;
    if (pending === entry) pending = null;
    return entry;
  }

  function beginHistory() {
    if (internal || !S?.doc) return;
    if (pending?.pending) finalize(pending);
    const entry = {
      ephLocalV22: true,
      pending: true,
      label: '',
      beforeAll: captureStates(),
      beforeRaw: captureRaw(selectedIds()),
      beforeSelection: captureSelection(),
      afterRaw: {},
    };
    S.undo.push(entry);
    if (S.undo.length > MAX_HISTORY) S.undo.shift();
    S.redo = [];
    pending = entry;
  }

  function applyDelta(current, target, source, conflicts) {
    const keys = new Set([...Object.keys(target || {}), ...Object.keys(source || {})]);
    for (const key of keys) {
      if (['id', 'dmxId'].includes(key)) continue;
      const targetValue = target?.[key];
      const sourceValue = source?.[key];
      if (equal(targetValue, sourceValue)) continue;
      const currentValue = current?.[key];
      if (plain(targetValue) && plain(sourceValue) && plain(currentValue)) {
        applyDelta(currentValue, targetValue, sourceValue, conflicts);
        continue;
      }
      if (!equal(currentValue, sourceValue)) {
        conflicts.count++;
        continue;
      }
      if (targetValue === undefined) delete current[key];
      else current[key] = clone(targetValue);
    }
  }

  function fixElementId(element, dmxId) {
    const field = element?.fields?.find(item => item.key === 'id');
    if (field && dmxId) field.value = String(dmxId);
  }

  function recreate(state, raw) {
    if (!state?.id) return null;
    if (state.type === 'folder') {
      const folder = clone(state);
      S.objects.push(folder);
      return folder;
    }
    if (raw && state.dmxId) {
      const copy = clone(raw);
      VMAP.getWorldChildren?.(S.doc)?.push(copy);
      let object = VMAP.extractObjects?.(S.doc)?.find(item => item.id === state.id || item.dmxId === state.dmxId) || null;
      if (object) {
        object = ensureObject(object);
        Object.assign(object, clone(state));
        S.objects.push(object);
        return object;
      }
    }

    let object = null;
    if (['part', 'terrain', 'decal'].includes(state.type)) {
      object = VMAP.addPart?.(S.doc, {
        vertices: clone(state.vertices || []),
        faces: clone(state.faces || []),
        faceMaterials: clone(state.faceMaterials || []),
        materials: clone(state.materials || {}),
        position: clone(state.position || [0, 0, 0]),
        rotation: clone(state.rotation || [0, 0, 0]),
        scale: clone(state.scale || [1, 1, 1]),
        collision: state.collision !== false,
      });
    } else if (['entity', 'prop'].includes(state.type)) {
      object = VMAP.addEntity?.(S.doc, {
        className: state.className || (state.type === 'prop' ? 'prop_static' : 'info_target'),
        model: state.model || '',
        name: state.name || '',
        position: clone(state.position || [0, 0, 0]),
        rotation: clone(state.rotation || [0, 0, 0]),
        scale: clone(state.scale || [1, 1, 1]),
        collision: state.collision !== false,
        entityProperties: clone(state.entityProperties || {}),
      });
    }
    if (!object) return null;
    object = ensureObject(object);
    if (state.dmxId && object.dmxId !== state.dmxId) {
      const element = VMAP.findElementByDmxId?.(S.doc, object.dmxId);
      fixElementId(element, state.dmxId);
    }
    Object.assign(object, clone(state));
    S.objects.push(object);
    VMAP.applyObjectToDocument?.(S.doc, object);
    return object;
  }

  function removeCurrent(object) {
    if (!object) return false;
    if (object.dmxId) VMAP.removeObject?.(S.doc, object);
    const index = S.objects.findIndex(item => item.id === object.id);
    if (index >= 0) S.objects.splice(index, 1);
    return true;
  }

  function restoreSelection(selection) {
    const ids = (selection?.ids || []).filter(id => S.objects.some(item => item.id === id));
    const primary = ids.includes(selection?.primary) ? selection.primary : ids[0] || (S.objects.some(item => item.id === 'world') ? 'world' : null);
    S.selectedId = primary;
    S.selectedFaces = new Set(selection?.faces?.length ? selection.faces : [0]);
    S.subSelection = null;
    if (window.EPH_MULTI_SELECTION?.set) window.EPH_MULTI_SELECTION.set(ids.length ? ids : [primary].filter(Boolean), primary, { render: false });
  }

  function applyEntry(entry, direction) {
    if (!entry?.ephLocalV22) return false;
    finalize(entry);
    const undoing = direction === 'undo';
    const targetMap = undoing ? entry.before : entry.after;
    const sourceMap = undoing ? entry.after : entry.before;
    const targetRaw = undoing ? entry.beforeRaw : entry.afterRaw;
    const selection = undoing ? entry.beforeSelection : entry.afterSelection;
    const conflicts = { count: 0 };
    internal = true;
    try {
      for (const id of entry.ids || []) {
        const target = targetMap?.[id] || null;
        const source = sourceMap?.[id] || null;
        const current = S.objects.find(item => item.id === id) || null;

        if (!target && source) {
          if (!current) continue;
          if (!equal(objectState(current), source)) {
            conflicts.count++;
            continue;
          }
          removeCurrent(current);
          continue;
        }

        if (target && !source) {
          if (current) {
            conflicts.count++;
            continue;
          }
          recreate(target, targetRaw?.[id] || null);
          continue;
        }

        if (!target || !source || !current) {
          if (target && !current) recreate(target, targetRaw?.[id] || null);
          continue;
        }

        applyDelta(current, target, source, conflicts);
        ensureObject(current);
        if (current.dmxId) VMAP.applyObjectToDocument?.(S.doc, current);
      }

      restoreSelection(selection);
      renderAll?.();
      S.viewport?.setObjects?.(S.objects, S.selectedId);
      if (typeof rawMarkDirty === 'function') rawMarkDirty(`${undoing ? 'Undo' : 'Redo'}: ${entry.label || 'local edit'}`);
      else {
        S.dirty = true;
        updateTitle?.();
      }
      if (conflicts.count) toast?.(`${undoing ? 'Undo' : 'Redo'} preserved ${conflicts.count} collaborator change${conflicts.count === 1 ? '' : 's'}.`);
      return true;
    } finally {
      internal = false;
    }
  }

  function localUndo() {
    if (pending?.pending) finalize(pending);
    while (S.undo.length) {
      const entry = S.undo.pop();
      if (!entry?.ephLocalV22) continue;
      if (applyEntry(entry, 'undo')) {
        S.redo.push(entry);
        return;
      }
    }
  }

  function localRedo() {
    if (pending?.pending) finalize(pending);
    while (S.redo.length) {
      const entry = S.redo.pop();
      if (!entry?.ephLocalV22) continue;
      if (applyEntry(entry, 'redo')) {
        S.undo.push(entry);
        return;
      }
    }
  }

  function install() {
    if (installed || !VMAP || typeof S === 'undefined') return installed;
    if (typeof pushHistory !== 'function' || typeof markDirty !== 'function' || typeof undo !== 'function' || typeof redo !== 'function') return false;
    // Install after collab-runtime has wrapped markDirty so undo/redo is also broadcast.
    if (!window.EPH_COLLAB || !markDirty.__ephCollaboration) return false;

    rawMarkDirty = markDirty;
    pushHistory = beginHistory;
    markDirty = function(message) {
      if (internal) return rawMarkDirty(message);
      const result = rawMarkDirty(message);
      if (pending?.pending) {
        pending.label = message || pending.label || 'local edit';
        finalize(pending);
      }
      return result;
    };
    undo = localUndo;
    redo = localRedo;
    window.pushHistory = pushHistory;
    window.markDirty = markDirty;
    window.undo = undo;
    window.redo = redo;
    S.undo = [];
    S.redo = [];
    installed = true;
    console.info('[History V22] Local-only collaboration undo/redo installed.');
    return true;
  }

  window.EPH_LOCAL_HISTORY = {
    install,
    finalize: () => finalize(pending),
    undo: localUndo,
    redo: localRedo,
    active: () => installed,
  };

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 200);
    setTimeout(() => clearInterval(timer), 30000);
  }
})();
