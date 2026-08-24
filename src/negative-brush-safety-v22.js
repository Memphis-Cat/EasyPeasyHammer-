// byanca
(() => {
  'use strict';
  if (window.__ephNegativeBrushSafetyV22) return;
  window.__ephNegativeBrushSafetyV22 = true;

  const VMAP = window.EPH_VMAP;
  const csgHistory = [];
  const MAX_CSG_HISTORY = 24;
  let installed = false;
  let propertiesObserver = null;

  const clone = value => {
    try { return structuredClone(value); }
    catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
  };
  const field = (element, key) => element?.fields?.find(item => item?.key === key) || null;
  const elementId = element => String(field(element, 'id')?.value || '');
  const projectKey = () => String(S?.project?.vmapPath || S?.project?.path || S?.project?.name || 'unsaved');

  function selectedPartIds() {
    const ids = new Set();
    const add = values => {
      for (const id of Array.isArray(values) ? values : []) if (id) ids.add(id);
    };
    try { add(window.EPH_MULTI_SELECTION?.ids?.()); } catch {}
    add(S?.multiSelectedIds);
    add(S?.viewport?.multiSelectedIds);
    if (S?.selectedId) ids.add(S.selectedId);
    return [...ids].filter(id => S?.objects?.some(object => object?.id === id && object?.type === 'part'));
  }

  function capture() {
    if (!S?.doc) return null;
    const partIds = selectedPartIds();
    const parts = partIds.map(id => {
      const object = S.objects.find(item => item.id === id);
      return object ? { id: object.id, dmxId: object.dmxId || null, negative: Boolean(object.ephNegative) } : null;
    }).filter(Boolean);
    const negativeIds = parts.filter(part => part.negative).map(part => part.id);
    const normalIds = parts.filter(part => !part.negative).map(part => part.id);
    return {
      projectKey: projectKey(),
      text: VMAP.stringify(S.doc),
      extras: typeof extras === 'function' ? clone(extras()) : null,
      selectedId: S.selectedId,
      selectedFaces: [...(S.selectedFaces || [])],
      multi: window.EPH_MULTI_SELECTION?.ids?.() || clone(S.multiSelectedIds || []),
      undo: [...(S.undo || [])],
      redo: [...(S.redo || [])],
      negativeIds,
      normalIds,
      parts,
      createdAt: Date.now(),
    };
  }

  function restore(snapshot) {
    if (!snapshot) return false;
    S.doc = VMAP.parse(snapshot.text);
    S.objects = VMAP.extractObjects(S.doc).map(ensureObject);
    if (snapshot.extras && typeof applyExtras === 'function') applyExtras(snapshot.extras);
    S.undo = snapshot.undo || [];
    S.redo = snapshot.redo || [];
    S.selectedId = S.objects.some(object => object.id === snapshot.selectedId) ? snapshot.selectedId : 'world';
    S.selectedFaces = new Set(snapshot.selectedFaces?.length ? snapshot.selectedFaces : [0]);
    S.subSelection = null;
    const ids = (snapshot.multi || []).filter(id => S.objects.some(object => object.id === id));
    window.EPH_MULTI_SELECTION?.set?.(ids, ids.includes(S.selectedId) ? S.selectedId : ids.at(-1), { render: false });
    renderAll?.();
    S.viewport?.setObjects?.(S.objects, S.selectedId);
    queueMicrotask(() => window.EPH_MULTI_SELECTION?.refresh?.());
    return true;
  }

  function detachByDmxId(doc, dmxId) {
    const wanted = String(dmxId || '');
    if (!wanted) return null;
    const visitArray = list => {
      if (!Array.isArray(list)) return null;
      for (let index = 0; index < list.length; index++) {
        const element = list[index];
        if (!element?.kind) continue;
        if (elementId(element) === wanted && ['CMapMesh', 'CMapEntity'].includes(element.className)) return list.splice(index, 1)[0];
        for (const item of element.fields || []) {
          if (Array.isArray(item.value)) {
            const found = visitArray(item.value);
            if (found) return found;
          } else if (item.value?.kind) {
            const found = visitArray([item.value]);
            if (found) return found;
          }
        }
      }
      return null;
    };
    return visitArray(VMAP.getWorldChildren?.(doc) || []);
  }

  function restoreCarveOnly(snapshot) {
    if (!snapshot || snapshot.projectKey !== projectKey() || !S?.doc) return false;
    const preDoc = VMAP.parse(snapshot.text);
    const currentExtras = typeof extras === 'function' ? clone(extras()) : {};
    const affected = snapshot.parts || [];
    const worldChildren = VMAP.getWorldChildren?.(S.doc);
    if (!Array.isArray(worldChildren)) return false;

    for (const part of affected) {
      if (!part?.dmxId) continue;
      detachByDmxId(S.doc, part.dmxId);
      const original = VMAP.findElementByDmxId?.(preDoc, part.dmxId);
      if (original) worldChildren.push(clone(original));
    }

    S.objects = VMAP.extractObjects(S.doc).map(ensureObject);
    if (typeof applyExtras === 'function') {
      const mergedExtras = currentExtras || {};
      for (const part of affected) {
        if (!part?.id) continue;
        if (snapshot.extras?.[part.id] !== undefined) mergedExtras[part.id] = clone(snapshot.extras[part.id]);
        else delete mergedExtras[part.id];
      }
      applyExtras(mergedExtras);
    }

    const preferred = (snapshot.negativeIds || []).find(id => S.objects.some(object => object.id === id))
      || (snapshot.normalIds || []).find(id => S.objects.some(object => object.id === id))
      || 'world';
    S.selectedId = preferred;
    S.selectedFaces = new Set([0]);
    S.subSelection = null;
    const ids = (snapshot.parts || []).map(part => part.id).filter(id => S.objects.some(object => object.id === id));
    window.EPH_MULTI_SELECTION?.set?.(ids, preferred, { render: false });
    renderAll?.();
    S.viewport?.setObjects?.(S.objects, preferred);
    queueMicrotask(() => {
      window.EPH_MULTI_SELECTION?.refresh?.();
      window.EPH_NEGATIVE_BRUSH?.refresh?.();
    });
    return true;
  }

  function syncCarvedRender(snapshot) {
    if (!snapshot) return 0;
    const viewport = S?.viewport || window.EPH3D;
    if (!viewport?.updateObject) return 0;
    let refreshed = 0;
    const details = [];
    for (const id of snapshot.normalIds || []) {
      const object = S?.objects?.find(item => item?.id === id);
      if (!object || object.type !== 'part') continue;
      viewport.updateObject(object);
      refreshed++;
      details.push({ id: object.id, name: object.name, vertices: object.vertices?.length || 0, faces: object.faces?.length || 0 });
    }
    if (S?.selectedId) viewport.select?.(S.selectedId, false);
    queueMicrotask(() => window.EPH_MULTI_SELECTION?.refresh?.());
    if (refreshed) {
      console.info('[Negative Brush Safety V22] Rebuilt carved viewport geometry after CSG.', { refreshed, objects: details });
      try {
        window.easyPeasyHammer?.appLog?.('normal', 'negative-brush-safety-v22', 'Rebuilt carved viewport geometry after CSG.', { refreshed, objects: details })?.catch?.(() => {});
      } catch {}
    }
    return refreshed;
  }

  function usableHistory() {
    const key = projectKey();
    while (csgHistory.length && csgHistory.at(-1)?.projectKey !== key) csgHistory.pop();
    return csgHistory.length;
  }

  function updateUndoButtons() {
    const enabled = usableHistory() > 0;
    for (const button of document.querySelectorAll('#ephCsgUndoTop,#ephNegativeUndoCsg')) {
      button.disabled = !enabled;
      button.classList.toggle('eph-csg-undo-ready', enabled);
      button.title = enabled ? 'Undo the newest CSG carve and restore its Negative Part' : 'No CSG carve to undo';
    }
  }

  function undoLastCsg() {
    if (!usableHistory()) {
      toast?.('No CSG carve to undo.');
      updateUndoButtons();
      return false;
    }
    const entry = csgHistory.at(-1);
    try { pushHistory?.(); } catch {}
    if (!restoreCarveOnly(entry.snapshot)) {
      toast?.('Could not restore the newest CSG carve.');
      updateUndoButtons();
      return false;
    }
    csgHistory.pop();
    try { markDirty?.('Undid newest CSG carve'); } catch {}
    try { log?.('CSG: restored carved Parts and Negative Part'); } catch {}
    console.info('[Negative Brush Safety V22] Undid newest CSG carve without rolling back unrelated map edits.', {
      negativeIds: entry.snapshot?.negativeIds || [],
      normalIds: entry.snapshot?.normalIds || [],
    });
    toast?.('Undid newest CSG carve. Negative Part restored.');
    updateUndoButtons();
    return true;
  }

  function ensureStyle() {
    if (document.getElementById('ephCsgUndoStyle')) return;
    const style = document.createElement('style');
    style.id = 'ephCsgUndoStyle';
    style.textContent = `
      #ephCsgUndoTop{white-space:nowrap}
      #ephCsgUndoTop.eph-csg-undo-ready{border-color:#4f8e62;background:#173822;color:#d8ffe3}
      #ephNegativeUndoCsg.eph-csg-undo-ready{border-color:#4f8e62;background:#173822;color:#d8ffe3}
    `;
    document.head.appendChild(style);
  }

  function ensureUndoButtons() {
    ensureStyle();

    if (!document.getElementById('ephCsgUndoTop')) {
      const anchor = document.getElementById('topAddPart');
      if (anchor?.parentElement) {
        const button = document.createElement('button');
        button.id = 'ephCsgUndoTop';
        button.type = 'button';
        button.className = 'tool-mode';
        button.innerHTML = '<span>Undo CSG</span>';
        button.onclick = undoLastCsg;
        anchor.after(button);
      }
    }

    const carve = document.getElementById('ephNegativeCarve');
    if (carve && !document.getElementById('ephNegativeUndoCsg')) {
      const button = document.createElement('button');
      button.id = 'ephNegativeUndoCsg';
      button.type = 'button';
      button.className = 'mini-button wide';
      button.textContent = 'Undo Last CSG';
      button.style.gridColumn = '1 / -1';
      button.onclick = undoLastCsg;
      carve.parentElement?.appendChild(button);
    }

    updateUndoButtons();
  }

  function observeProperties() {
    if (propertiesObserver) return;
    const host = document.getElementById('propertiesContent');
    if (!host) return;
    propertiesObserver = new MutationObserver(() => queueMicrotask(ensureUndoButtons));
    propertiesObserver.observe(host, { childList: true, subtree: true });
  }

  function install() {
    const runtime = window.EPH_NEGATIVE_BRUSH;
    if (installed || !runtime?.carve) return installed;
    const rawCarve = runtime.carve;
    const safeCarve = function() {
      const snapshot = capture();
      let result = false;
      try {
        result = rawCarve();
      } catch (error) {
        console.error('[Negative Brush Safety V22] CSG threw', error);
        result = false;
      }
      if (!result) restore(snapshot);
      else {
        syncCarvedRender(snapshot);
        if (snapshot) {
          csgHistory.push({ projectKey: snapshot.projectKey, snapshot });
          if (csgHistory.length > MAX_CSG_HISTORY) csgHistory.splice(0, csgHistory.length - MAX_CSG_HISTORY);
        }
      }
      ensureUndoButtons();
      return result;
    };
    runtime.carve = safeCarve;
    runtime.undoLastCarve = undoLastCsg;

    document.addEventListener('click', event => {
      const button = event.target?.closest?.('#ephNegativeCarve');
      if (!button || button.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      safeCarve();
    }, true);

    ensureUndoButtons();
    observeProperties();
    installed = true;
    console.info('[Negative Brush Safety V22] Atomic carve guard and dedicated targeted CSG undo installed.');
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => {
      ensureUndoButtons();
      observeProperties();
      if (install()) clearInterval(timer);
    }, 150);
    setTimeout(() => clearInterval(timer), 30000);
  }

  window.EPH_CSG_HISTORY = {
    undo: undoLastCsg,
    count: () => usableHistory(),
    clear: () => { csgHistory.length = 0; updateUndoButtons(); },
  };
})();
