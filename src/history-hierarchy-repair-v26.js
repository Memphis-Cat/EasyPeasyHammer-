// byanca
(() => {
  'use strict';
  if (window.__ephHistoryHierarchyRepairV26) return;
  window.__ephHistoryHierarchyRepairV26 = true;

  const VMAP = window.EPH_VMAP;
  const api = window.easyPeasyHammer;
  if (!VMAP) return;

  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const idOf = element => String(field(element, 'id')?.value || '');
  const childrenOf = element => {
    const value = field(element, 'children')?.value;
    return Array.isArray(value) ? value : [];
  };

  function report(level, message, data = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[History Hierarchy V26] ${message}`, data || '');
    try { api?.appLog?.(level, 'history-hierarchy-v26', message, data)?.catch?.(() => {}); } catch {}
  }

  function collectNodes(list, parentElement, depth, output) {
    if (!Array.isArray(list)) return;
    for (let index = 0; index < list.length; index++) {
      const element = list[index];
      if (!element?.kind) continue;
      if (['CMapMesh', 'CMapEntity'].includes(element.className)) {
        output.push({ element, list, index, parentElement, depth, id: idOf(element) });
      }
      collectNodes(childrenOf(element), element, depth + 1, output);
    }
  }

  function preferredOccurrence(group) {
    // A CMapMesh nested under a CMapEntity is the correct Source 2 representation
    // for brush/volume entities. Prefer it over an accidental top-level clone.
    return [...group].sort((a, b) => {
      const score = item => {
        let value = item.depth * 10;
        if (item.element.className === 'CMapMesh' && item.parentElement?.className === 'CMapEntity') value += 1000;
        if (item.element.className === 'CMapEntity') value += 100;
        return value;
      };
      return score(b) - score(a);
    })[0];
  }

  function repairDocument(doc) {
    if (!doc) return { removed: 0, ids: [] };
    const world = VMAP.getWorld?.(doc);
    const worldChildren = world ? childrenOf(world) : VMAP.getWorldChildren?.(doc);
    if (!Array.isArray(worldChildren)) return { removed: 0, ids: [] };

    const nodes = [];
    collectNodes(worldChildren, world, 0, nodes);
    const byId = new Map();
    for (const occurrence of nodes) {
      if (!occurrence.id) continue;
      if (!byId.has(occurrence.id)) byId.set(occurrence.id, []);
      byId.get(occurrence.id).push(occurrence);
    }

    const removals = [];
    const repairedIds = [];
    for (const [id, group] of byId) {
      if (group.length < 2) continue;
      const keep = preferredOccurrence(group);
      for (const occurrence of group) if (occurrence !== keep) removals.push(occurrence);
      repairedIds.push(id);
    }

    // Remove deepest/highest-index occurrences first so array indexes stay valid.
    removals.sort((a, b) => b.depth - a.depth || b.index - a.index);
    let removed = 0;
    for (const occurrence of removals) {
      const liveIndex = occurrence.list.indexOf(occurrence.element);
      if (liveIndex < 0) continue;
      occurrence.list.splice(liveIndex, 1);
      removed++;
    }
    return { removed, ids: repairedIds };
  }

  function reconcileEditorObjects() {
    if (!Array.isArray(S?.objects)) return;
    const extracted = VMAP.extractObjects?.(S.doc) || [];
    const parentById = new Map(extracted.filter(object => object?.id).map(object => [object.id, object.parent]));
    const seen = new Set();
    S.objects = S.objects.filter(object => {
      if (!object?.id) return true;
      if (seen.has(object.id)) return false;
      seen.add(object.id);
      return true;
    });
    for (const object of S.objects) if (parentById.has(object.id)) object.parent = parentById.get(object.id);
    if (S.selectedId && !S.objects.some(object => object.id === S.selectedId)) S.selectedId = 'world';
  }

  function repairCurrent({ announce = false } = {}) {
    if (typeof S === 'undefined' || !S.doc) return 0;
    const result = repairDocument(S.doc);
    if (!result.removed) return 0;
    reconcileEditorObjects();
    S.dirty = true;
    updateTitle?.();
    renderTree?.();
    renderProperties?.();
    S.viewport?.setObjects?.(S.objects, S.selectedId);
    report('warning', `Removed ${result.removed} duplicate VMAP node${result.removed === 1 ? '' : 's'} created by an old mesh-entity Undo.`, { elementIds: result.ids });
    if (announce) toast?.(`Repaired ${result.removed} duplicate VMAP node${result.removed === 1 ? '' : 's'}. Save again.`);
    return result.removed;
  }

  function installHistoryGuard() {
    const history = window.EPH_LOCAL_HISTORY;
    if (!history?.active?.() || history.__ephHierarchyV26) return false;
    history.__ephHierarchyV26 = true;

    const rawUndo = history.undo.bind(history);
    const rawRedo = history.redo.bind(history);
    const wrappedUndo = function(...args) {
      const result = rawUndo(...args);
      repairCurrent();
      return result;
    };
    const wrappedRedo = function(...args) {
      const result = rawRedo(...args);
      repairCurrent();
      return result;
    };
    history.undo = wrappedUndo;
    history.redo = wrappedRedo;
    try { undo = wrappedUndo; } catch {}
    try { redo = wrappedRedo; } catch {}
    window.undo = wrappedUndo;
    window.redo = wrappedRedo;
    report('normal', 'Mesh-entity Undo/Redo hierarchy guard installed.');
    return true;
  }

  function installSaveRepair() {
    if (VMAP.prepareForSave?.__ephHierarchyRepairV26) return;
    const rawPrepare = VMAP.prepareForSave.bind(VMAP);
    const wrapped = function(doc, objects) {
      // Repair the live document before any older validation pass runs.
      if (doc === S?.doc) repairCurrent({ announce: true });
      else repairDocument(doc);
      return rawPrepare(doc, objects);
    };
    wrapped.__ephHierarchyRepairV26 = true;
    wrapped.__ephPrevious = rawPrepare;
    VMAP.prepareForSave = wrapped;
  }

  function install() {
    installHistoryGuard();
    installSaveRepair();
    repairCurrent();
  }

  install();
  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    installHistoryGuard();
    installSaveRepair();
    if (checks >= 60) clearInterval(guard);
  }, 250);

  window.EPH_HISTORY_HIERARCHY_V26 = { repair: repairCurrent, repairDocument };
})();
