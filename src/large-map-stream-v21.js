// byanca
(() => {
  'use strict';
  if (window.__ephLargeMapStreamV21) return;
  window.__ephLargeMapStreamV21 = true;
  window.__ephLargeMapStreamV16 = true;

  const api = window.easyPeasyHammer;
  const VMAP = window.EPH_VMAP;
  const THREE = window.EPH_THREE || window.THREE;
  if (!api || !VMAP || !THREE) return;

  const CELL_SIZE = 1024;
  const BATCH = 10;
  const REFRESH_MS = 100;
  const UNLOAD_MS = 900;
  const MAX_RESIDENT = 520;
  const MAX_OCCLUSION_CHECKS = 4;
  const TREE_DELAY = 1800;

  const st = {
    active: false, token: null, entries: [], byId: new Map(), byDmx: new Map(),
    loaded: new Map(), pending: new Set(), bounds: new Map(), hidden: new Map(),
    objectById: new Map(), shownProps: new Set(), cells: [], cellMap: new Map(),
    refreshTimer: null, treeTimer: null, pumping: false, rawSet: null, rawSave: null,
    rawUi: null, oldPixelRatio: null, refreshCount: 0, lastRefreshMs: 0,
  };

  const vec = (value, fallback=[0,0,0]) => Array.isArray(value)
    ? fallback.map((item, index) => Number.isFinite(Number(value[index])) ? Number(value[index]) : item)
    : [...fallback];

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Large Stream V21] ${message}`, meta || '');
    api?.appLog?.(level, 'large-stream-v21', message, meta).catch?.(() => {});
  }

  function proxy(entry) {
    const dmx = entry.dmxId || entry.entryId;
    const cls = String(entry.className || 'info_target');
    return ensureObject({
      id: `entity:${dmx}`, dmxId: dmx,
      type: cls.startsWith('prop_') && entry.model ? 'prop' : 'entity',
      sourceClass: 'CMapEntity', name: entry.targetname || entry.label || cls,
      className: cls, model: entry.model || '', position: vec(entry.position),
      rotation: vec(entry.rotation), scale: vec(entry.scale, [1,1,1]), size: [64,64,64],
      visible: entry.visible !== false, collision: true, entityProperties: {}, parent: 'world',
      ephLargeEntryId: entry.entryId, ephLargeProxy: true,
    });
  }

  function worldPosition(entry) {
    const position = vec(entry?.position);
    let id = entry?.parentEntryId, guard = 0;
    while (id && guard++ < 12) {
      const parent = st.byId.get(id); if (!parent) break;
      const p = vec(parent.position);
      position[0] += p[0]; position[1] += p[1]; position[2] += p[2];
      id = parent.parentEntryId;
    }
    return position;
  }

  function containerEntry(entry) {
    let current = entry, guard = 0;
    while (current?.parentEntryId && guard++ < 12) {
      const parent = st.byId.get(current.parentEntryId); if (!parent) break;
      if (parent.type === 'entity') return parent;
      current = parent;
    }
    return entry;
  }

  function entrySphereData(entry) {
    const objectId = st.loaded.get(entry.entryId);
    const cached = objectId && st.bounds.get(objectId);
    if (cached) return { c: cached.c, r: cached.r };
    const scale = vec(entry.scale, [1,1,1]);
    const radius = Math.max(8, Number(entry.approxRadius) || (entry.type === 'mesh' ? 512 : 96)) * Math.max(1, ...scale.map(value => Math.abs(value)));
    return { c: worldPosition(entry), r: radius };
  }

  function sphere(entry) {
    const data = entrySphereData(entry);
    return new THREE.Sphere(new THREE.Vector3(...data.c), data.r);
  }

  function distance(entry) {
    const camera = S.viewport?.camera; if (!camera) return Infinity;
    const data = entrySphereData(entry);
    return camera.position.distanceTo(new THREE.Vector3(...data.c));
  }

  function rebuildObjectIndex() {
    st.objectById.clear();
    for (const item of S.objects || []) if (item?.id) st.objectById.set(item.id, item);
  }

  function cellKey(position) {
    return `${Math.floor(position[0] / CELL_SIZE)},${Math.floor(position[1] / CELL_SIZE)},${Math.floor(position[2] / CELL_SIZE)}`;
  }

  function buildSpatialCells() {
    st.cellMap.clear(); st.cells = [];
    for (const entry of st.entries) {
      if (!entry || entry.visible === false) continue;
      const data = entrySphereData(entry);
      const key = cellKey(data.c);
      let cell = st.cellMap.get(key);
      if (!cell) {
        cell = { key, entries: [], min: [Infinity,Infinity,Infinity], max: [-Infinity,-Infinity,-Infinity], box: null };
        st.cellMap.set(key, cell); st.cells.push(cell);
      }
      cell.entries.push(entry);
      for (let axis = 0; axis < 3; axis++) {
        cell.min[axis] = Math.min(cell.min[axis], data.c[axis] - data.r);
        cell.max[axis] = Math.max(cell.max[axis], data.c[axis] + data.r);
      }
    }
    for (const cell of st.cells) cell.box = new THREE.Box3(new THREE.Vector3(...cell.min), new THREE.Vector3(...cell.max));
    report('normal', `Built ${st.cells.length.toLocaleString()} spatial cells for ${st.entries.length.toLocaleString()} streamed objects.`, { cellSize: CELL_SIZE });
  }

  function addElement(element) {
    const children = VMAP.getWorldChildren?.(S.doc);
    if (!Array.isArray(children) || !element) return;
    const id = element.fields?.find(item => item.key === 'id')?.value;
    if (id && VMAP.findElementByDmxId?.(S.doc, id)) return;
    children.push(element);
  }

  function parseBlock(text, entry) {
    const fragment = VMAP.parse(String(text || ''));
    const expected = entry.type === 'mesh' ? 'CMapMesh' : 'CMapEntity';
    const element = fragment.elements?.find(item => item?.className === expected);
    if (!element) throw new Error(`Could not parse ${entry.type} block`);
    const doc = VMAP.createEmptyDocument();
    VMAP.getWorldChildren(doc).push(element);
    return { element, objects: VMAP.extractObjects(doc).filter(item => item?.dmxId).map(ensureObject) };
  }

  function cacheBounds(object, root) {
    requestAnimationFrame(() => {
      if (!root?.parent) return;
      const box = new THREE.Box3().setFromObject(root); if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      st.bounds.set(object.id, { c: center.toArray(), r: Math.max(8, size.length() / 2) });
    });
  }

  function showRoot(object) {
    const viewport = S.viewport;
    if (!viewport || !object || object.visible === false || viewport.objectRoots.has(object.id)) return;
    if (st.active && object.type === 'entity' && object.id !== S.selectedId) return;
    const root = viewport.createObjectRoot(object); if (!root) return;
    viewport.objectGroup.add(root); viewport.objectRoots.set(object.id, root);
    if (object.ephLargeProxy && object.type === 'prop') st.shownProps.add(object.id);
    cacheBounds(object, root);
    if (S.selectedId === object.id) viewport.select(object.id, false);
  }

  function hideRoot(id) {
    const viewport = S.viewport, root = viewport?.objectRoots?.get(id);
    if (!root || id === S.selectedId) return;
    const object = st.objectById.get(id);
    if (object) cacheBounds(object, root);
    viewport.objectGroup.remove(root); viewport.disposeObject(root); viewport.objectRoots.delete(id);
    st.shownProps.delete(id);
  }

  function evict(entry) {
    const id = st.loaded.get(entry.entryId), object = id && st.objectById.get(id);
    if (!id || id === S.selectedId || object?.ephLargeDirty) return;
    hideRoot(id);
    try { VMAP.removeObject(S.doc, object); } catch {}
    S.objects = S.objects.filter(item => item.id !== id);
    st.objectById.delete(id);
    S.viewport.objects = S.objects;
    st.loaded.delete(entry.entryId);
  }

  function bind(entry, objects) {
    for (const object of objects) {
      const own = st.byDmx.get(String(object.dmxId)) || entry;
      object.ephLargeEntryId = own.entryId;
      object.ephLargeStreamed = true;
      st.loaded.set(own.entryId, object.id);
    }
    if (entry.type === 'entity') {
      const proxyId = `entity:${entry.dmxId || entry.entryId}`;
      S.objects = S.objects.filter(item => item.id !== proxyId);
      st.objectById.delete(proxyId);
    }
    for (const object of objects) {
      const previous = st.objectById.get(object.id);
      if (previous) {
        const index = S.objects.indexOf(previous);
        if (index >= 0) S.objects[index] = object;
      } else S.objects.push(object);
      st.objectById.set(object.id, object);
      showRoot(object);
    }
    S.viewport.objects = S.objects;
  }

  function scheduleTree() {
    if (st.treeTimer) return;
    st.treeTimer = setTimeout(() => {
      st.treeTimer = null;
      if (!st.active) return;
      try { renderTree?.(); if (S.selectedId) renderProperties?.(); } catch {}
    }, TREE_DELAY);
  }

  async function loadEntries(entries) {
    if (!st.active || st.pumping) return;
    const containers = [], seen = new Set();
    for (const entry of entries) {
      const container = containerEntry(entry);
      if (!container || seen.has(container.entryId) || st.pending.has(container.entryId) || st.loaded.has(container.entryId)) continue;
      seen.add(container.entryId); containers.push(container);
      if (containers.length >= BATCH) break;
    }
    if (!containers.length) return;
    st.pumping = true; containers.forEach(item => st.pending.add(item.entryId));
    try {
      const result = await api.largeMapGetBlocks?.(st.token, containers.map(item => item.entryId));
      if (!st.active || !result?.ok) return;
      for (const block of result.blocks || []) {
        const entry = st.byId.get(block.entryId); if (!entry) continue;
        try { const parsed = parseBlock(block.text, entry); addElement(parsed.element); bind(entry, parsed.objects); }
        catch (error) { report('error', `Large-map block ${block.entryId} failed.`, error?.stack || error?.message || String(error)); }
      }
      scheduleTree();
    } finally {
      containers.forEach(item => st.pending.delete(item.entryId));
      st.pumping = false; schedule();
    }
  }

  function frustum() {
    const viewport = S.viewport;
    viewport.camera.updateMatrixWorld();
    return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(viewport.camera.projectionMatrix, viewport.camera.matrixWorldInverse));
  }

  function occluders() {
    const output = [];
    for (const [id, root] of S.viewport?.objectRoots || []) {
      const object = st.objectById.get(id);
      if (object?.type === 'part' && object.ephLargeStreamed) output.push(root);
    }
    return output;
  }

  function occluded(entry, roots) {
    if (roots.length < 16) return false;
    const camera = S.viewport.camera, s = sphere(entry), c = s.center, r = s.radius, ray = S.viewport.raycaster;
    const samples = [
      c.clone(), c.clone().add(new THREE.Vector3(r,0,0)), c.clone().add(new THREE.Vector3(-r,0,0)),
      c.clone().add(new THREE.Vector3(0,r,0)), c.clone().add(new THREE.Vector3(0,-r,0)),
      c.clone().add(new THREE.Vector3(0,0,r)), c.clone().add(new THREE.Vector3(0,0,-r)),
    ];
    for (const point of samples) {
      const direction = point.clone().sub(camera.position), length = direction.length();
      if (length < 1) return false;
      direction.normalize(); ray.set(camera.position, direction); ray.near = .1;
      ray.far = Math.max(.1, length - Math.max(4, r * .04));
      const hit = ray.intersectObjects(roots, true)[0]; ray.far = Infinity;
      if (!hit) return false;
    }
    return true;
  }

  function visibleEntries(view) {
    const output = [];
    for (const cell of st.cells) {
      if (!view.intersectsBox(cell.box)) continue;
      for (const entry of cell.entries) if (entry.visible !== false && view.intersectsSphere(sphere(entry))) output.push(entry);
    }
    return output;
  }

  function unloadInvisible(view, now) {
    for (const [entryId] of [...st.loaded]) {
      const entry = st.byId.get(entryId); if (!entry) continue;
      const visible = view.intersectsSphere(sphere(entry));
      if (visible) { st.hidden.delete(entryId); continue; }
      if (!st.hidden.has(entryId)) st.hidden.set(entryId, now);
      if (now - st.hidden.get(entryId) > UNLOAD_MS && entry.type === 'mesh') evict(entry);
    }
    for (const objectId of [...st.shownProps]) {
      const object = st.objectById.get(objectId), entry = object && st.byId.get(object.ephLargeEntryId);
      if (!entry || view.intersectsSphere(sphere(entry))) { st.hidden.delete(objectId); continue; }
      if (!st.hidden.has(objectId)) st.hidden.set(objectId, now);
      if (now - st.hidden.get(objectId) > UNLOAD_MS) hideRoot(objectId);
    }
  }

  function refresh() {
    if (!st.active || !S.viewport?.camera) return;
    const started = performance.now(), view = frustum(), now = performance.now();
    const entries = visibleEntries(view), meshes = [], props = [];

    for (const entry of entries) {
      const loadedId = st.loaded.get(entry.entryId);
      if (entry.type === 'entity') {
        const proxyId = `entity:${entry.dmxId || entry.entryId}`;
        const object = loadedId ? st.objectById.get(loadedId) : st.objectById.get(proxyId);
        if (object?.type === 'prop' && !S.viewport.objectRoots.has(object.id)) props.push({ entry, object });
        else if (object?.type === 'entity' && object.id === S.selectedId && !S.viewport.objectRoots.has(object.id)) showRoot(object);
      } else if (!loadedId && !st.pending.has(containerEntry(entry)?.entryId || entry.entryId)) meshes.push(entry);
    }

    unloadInvisible(view, now);

    const selected = st.objectById.get(S.selectedId);
    if (selected?.ephLargeProxy) {
      const entry = st.byId.get(selected.ephLargeEntryId);
      if (entry) loadEntries([entry]);
    }

    const roots = occluders();
    const candidates = [
      ...meshes.map(entry => ({ kind: 'mesh', entry, d: distance(entry) })),
      ...props.map(item => ({ kind: 'prop', ...item, d: distance(item.entry) })),
    ].sort((a,b) => a.d - b.d);
    const toMesh = [];
    let count = 0, checks = 0;
    for (const candidate of candidates) {
      if (count >= BATCH) break;
      if (roots.length >= 16 && checks < MAX_OCCLUSION_CHECKS && candidate.d > 256) {
        checks++;
        if (occluded(candidate.entry, roots)) continue;
      }
      if (candidate.kind === 'prop') showRoot(candidate.object); else toMesh.push(candidate.entry);
      count++;
    }
    if (toMesh.length) loadEntries(toMesh);

    const resident = [...st.loaded.keys()].map(id => st.byId.get(id)).filter(entry => entry?.type === 'mesh');
    if (resident.length > MAX_RESIDENT) {
      resident.sort((a,b) => distance(b) - distance(a));
      resident.slice(MAX_RESIDENT).forEach(evict);
    }

    st.refreshCount++;
    st.lastRefreshMs = performance.now() - started;
    if (st.refreshCount <= 3 || st.refreshCount % 100 === 0) {
      report(st.lastRefreshMs > 12 ? 'warning' : 'normal', `Visibility refresh checked ${st.cells.length} cells / ${entries.length} in-view entries in ${st.lastRefreshMs.toFixed(1)} ms.`, {
        totalEntries: st.entries.length, resident: st.loaded.size, pending: st.pending.size,
      });
    }
  }

  function schedule() {
    if (!st.active || st.refreshTimer) return;
    st.refreshTimer = setTimeout(() => { st.refreshTimer = null; refresh(); }, REFRESH_MS);
  }

  function installViewport() {
    const viewport = S.viewport || window.EPH3D; if (!viewport) return;
    viewport.scene.background = new THREE.Color(0); try { viewport.renderer.setClearColor(0,1); } catch {}
    if (st.oldPixelRatio == null) st.oldPixelRatio = viewport.renderer.getPixelRatio?.() || 1;
    try { viewport.renderer.setPixelRatio(1); viewport.resize?.(); } catch {}
    if (!viewport.__ephLargeSetObjectsV21) {
      viewport.__ephLargeSetObjectsV21 = true;
      st.rawSet = viewport.setObjects.bind(viewport);
      viewport.setObjects = function(objects, selectedId=null) {
        if (!st.active) return st.rawSet(objects, selectedId);
        this.objects = objects || []; this.selectedId = selectedId || null;
        schedule(); if (selectedId && this.objectRoots.has(selectedId)) this.select(selectedId, false);
      };
      const select = viewport.select.bind(viewport);
      viewport.select = function(id, notify=true) { const result = select(id, notify); if (st.active) schedule(); return result; };
      viewport.orbit.addEventListener('change', schedule);
    }
  }

  function initialCamera() {
    if (S.camera) return;
    const entry = st.entries.find(item => /info_player_(counterterrorist|terrorist)/i.test(item.className || '')) || st.entries.find(item => item.type === 'mesh') || st.entries[0];
    if (!entry || !S.viewport) return;
    const point = new THREE.Vector3(...worldPosition(entry));
    S.viewport.orbit.target.copy(point.clone().add(new THREE.Vector3(0,0,48)));
    S.viewport.camera.position.copy(point.clone().add(new THREE.Vector3(240,-360,180)));
    S.viewport.camera.lookAt(S.viewport.orbit.target); S.viewport.orbit.update();
  }

  function markDirty() {
    if (VMAP.applyObjectToDocument.__ephLargeDirtyV21) return;
    const raw = VMAP.applyObjectToDocument.bind(VMAP);
    VMAP.applyObjectToDocument = function(doc, object) {
      const result = raw(doc, object);
      if (st.active && object?.ephLargeEntryId && !object.ephLargeProxy) object.ephLargeDirty = true;
      return result;
    };
    VMAP.applyObjectToDocument.__ephLargeDirtyV21 = true;
  }

  function elementText(element) {
    return VMAP.stringify({ header: VMAP.DEFAULT_HEADER, elements: [element] }).replace(/^<!--\s*dmx[^\n]*-->\s*/i, '');
  }
  function replacementEntry(object) {
    let entry = st.byId.get(object?.ephLargeEntryId), guard = 0;
    while (entry?.parentEntryId && guard++ < 12) {
      const parent = st.byId.get(entry.parentEntryId); if (!parent) break;
      if (parent.type === 'entity') return parent;
      entry = parent;
    }
    return entry;
  }
  function replacementElement(entry, object) {
    if (entry?.type === 'entity' && entry.dmxId) {
      const element = VMAP.findElementByDmxId?.(S.doc, entry.dmxId); if (element) return element;
    }
    return object?.dmxId ? VMAP.findElementByDmxId?.(S.doc, object.dmxId) || null : null;
  }

  async function saveLarge(show=true) {
    if (!st.active) return st.rawSave?.(show);
    const patches = new Map(), newBlocks = [];
    for (const object of S.objects) {
      if (object?.dmxId && !object.ephLargeEntryId && !object.ephLargeProxy && object.type !== 'world') {
        const element = VMAP.findElementByDmxId?.(S.doc, object.dmxId); if (element) newBlocks.push(elementText(element));
        continue;
      }
      if (!object?.ephLargeDirty || !object.ephLargeEntryId || object.ephLargeProxy) continue;
      const entry = replacementEntry(object), element = replacementElement(entry, object);
      if (entry && element) patches.set(entry.entryId, { entryId: entry.entryId, text: elementText(element) });
    }
    if (!patches.size && !newBlocks.length) {
      S.dirty = false; updateTitle?.(); if (show) toast?.('Map already saved'); return true;
    }
    const status = document.getElementById('autosaveStatus'); if (status) status.textContent = 'Saving VMAP...';
    const result = await api.largeMapSave?.(st.token, S.project.vmapPath, [...patches.values()], newBlocks);
    if (!result?.ok) { log?.(`Save failed: ${result?.error || 'unknown error'}`, 'error'); toast?.('Save failed'); return false; }
    if (result.largeMapToken) st.token = result.largeMapToken;
    if (Array.isArray(result.entries)) {
      st.entries = result.entries; st.byId = new Map(st.entries.map(item => [item.entryId, item]));
      st.byDmx = new Map(st.entries.filter(item => item.dmxId).map(item => [String(item.dmxId), item]));
      buildSpatialCells();
      for (const object of S.objects) {
        if (!object?.dmxId || object.ephLargeEntryId) continue;
        const entry = st.byDmx.get(String(object.dmxId));
        if (entry) { object.ephLargeEntryId = entry.entryId; object.ephLargeStreamed = true; }
      }
    }
    S.objects.forEach(item => delete item.ephLargeDirty);
    S.project.ephLargeMapToken = st.token; S.dirty = false; updateTitle?.();
    if (status) status.textContent = `Saved ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    log?.(`Saved ${S.project.vmapPath}`, 'success'); if (show) toast?.('VMAP saved'); return true;
  }

  function installSave() {
    if (!st.rawSave) st.rawSave = typeof window.save === 'function' ? window.save : null;
    const wrapped = async (show=true) => st.active ? saveLarge(show) : st.rawSave?.(show);
    window.save = wrapped; try { save = wrapped; } catch {}
    for (const id of ['toolbarSave','toolbarSaveAll','exportButton']) {
      const button = document.getElementById(id); if (button) { button.disabled = false; button.onclick = () => wrapped(true); }
    }
    window.addEventListener('keydown', event => {
      if (!st.active || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault(); event.stopImmediatePropagation(); saveLarge(true);
    }, true);
    if (!st.rawUi && typeof window.uiSnapshot === 'function') st.rawUi = window.uiSnapshot;
    if (st.rawUi && !st.rawUi.__ephLargeUiV21) {
      const raw = st.rawUi;
      const ui = function(...args) {
        const value = raw(...args);
        if (st.active && value) { delete value.vmapText; value.ephLargeMap = true; value.camera = S.camera || value.camera; }
        return value;
      };
      ui.__ephLargeUiV21 = true; window.uiSnapshot = ui; try { uiSnapshot = ui; } catch {}
    }
  }

  async function open(rawLoad, project, decoded, ui) {
    st.active = false;
    const tiny = VMAP.createEmptyDocument();
    const ok = await rawLoad({ ...project, ephSkipModelWarmup: true }, { ...(ui || {}), vmapText: VMAP.stringify(tiny) });
    if (!ok) return false;
    st.active = true; st.token = decoded.largeMapToken;
    st.entries = Array.isArray(decoded.largeMapEntries) ? decoded.largeMapEntries : [];
    st.byId = new Map(st.entries.map(item => [item.entryId, item]));
    st.byDmx = new Map(st.entries.filter(item => item.dmxId).map(item => [String(item.dmxId), item]));
    st.loaded.clear(); st.pending.clear(); st.bounds.clear(); st.hidden.clear(); st.shownProps.clear();
    S.project = { ...project, ephLargeMap: true, ephLargeMapToken: st.token, ephLargeMapStats: { meshCount: decoded.meshCount, entityCount: decoded.entityCount, decodedBytes: decoded.decodedBytes } };
    S.doc = tiny; S.objects = VMAP.extractObjects(tiny).map(ensureObject);
    for (const entry of st.entries) if (entry.type === 'entity') S.objects.push(proxy(entry));
    rebuildObjectIndex(); buildSpatialCells();
    S.selectedId = 'world'; S.dirty = false; installViewport(); markDirty(); installSave();
    if (S.viewport) { S.viewport.objects = S.objects; S.viewport.clearObjects(); initialCamera(); }
    renderAll?.(); updateTitle?.(); schedule();
    await api.autosave?.({ project: S.project, uiState: window.uiSnapshot?.() || null });
    report('normal', 'Streamed map opened with cell-based visibility.', { entries: st.entries.length, cells: st.cells.length, pixelRatio: 1 });
    return true;
  }

  async function close() {
    if (!st.active) return;
    st.active = false; clearTimeout(st.refreshTimer); clearTimeout(st.treeTimer);
    try { await api.largeMapRelease?.(st.token); } catch {}
    try { if (S.viewport && st.oldPixelRatio != null) { S.viewport.renderer.setPixelRatio(st.oldPixelRatio); S.viewport.resize?.(); } } catch {}
    st.token = null; st.entries = []; st.byId.clear(); st.byDmx.clear(); st.loaded.clear(); st.pending.clear();
    st.bounds.clear(); st.hidden.clear(); st.objectById.clear(); st.shownProps.clear(); st.cells = []; st.cellMap.clear();
  }

  window.EPH_LARGE_STREAM = {
    open, close, refresh, save: saveLarge,
    active: () => st.active,
    state: () => ({ active: st.active, token: st.token, entries: st.entries.length, loaded: st.loaded.size, pending: st.pending.size, cells: st.cells.length, refreshMs: Number(st.lastRefreshMs.toFixed(2)) }),
  };
})();
