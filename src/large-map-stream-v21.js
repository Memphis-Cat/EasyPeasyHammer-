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

  const CELL_SIZE = 512;
  const BATCH = 24;
  const REFRESH_MS = 90;
  const TREE_DELAY = 5000;
  const INITIAL_CONTAINER_TARGET = 1400;
  const MODEL_WORKERS = 6;
  const MATERIAL_WORKERS = 12;

  const st = {
    active: false, preloading: false, token: null, entries: [], byId: new Map(), byDmx: new Map(),
    loaded: new Map(), loadedContainers: new Set(), pending: new Set(), bounds: new Map(),
    objectById: new Map(), shownProps: new Set(), cells: [], cellMap: new Map(), sphereData: new Map(),
    refreshTimer: null, treeTimer: null, pumping: false, rawSet: null, rawSave: null,
    rawUi: null, oldPixelRatio: null, refreshCount: 0, lastRefreshMs: 0,
    preloadTarget: 0, preloadDone: 0, modelWarmTarget: 0, modelWarmDone: 0,
    frustum: new THREE.Frustum(), projectionMatrix: new THREE.Matrix4(),
  };

  const vec = (value, fallback=[0,0,0]) => Array.isArray(value)
    ? fallback.map((item, index) => Number.isFinite(Number(value[index])) ? Number(value[index]) : item)
    : [...fallback];

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Large Stream V29] ${message}`, meta || '');
    api?.appLog?.(level, 'large-stream-v29', message, meta).catch?.(() => {});
  }

  function loadingStage(text) {
    const title = document.getElementById('ephComplexVmapLoadingTitle');
    if (title && !document.getElementById('ephComplexVmapLoading')?.hidden) title.textContent = text;
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
    const dynamic = objectId && st.bounds.get(objectId);
    if (dynamic) return dynamic;
    let cached = st.sphereData.get(entry.entryId);
    if (cached) return cached;
    const scale = vec(entry.scale, [1,1,1]);
    const radius = Math.max(8, Number(entry.approxRadius) || (entry.type === 'mesh' ? 512 : 96)) * Math.max(1, ...scale.map(value => Math.abs(value)));
    const c = worldPosition(entry);
    cached = { c, r: radius, sphere: new THREE.Sphere(new THREE.Vector3(c[0], c[1], c[2]), radius) };
    st.sphereData.set(entry.entryId, cached);
    return cached;
  }

  function sphere(entry) { return entrySphereData(entry).sphere; }

  function distance(entry) {
    const camera = S.viewport?.camera; if (!camera) return Infinity;
    const c = entrySphereData(entry).c;
    const x = camera.position.x - c[0], y = camera.position.y - c[1], z = camera.position.z - c[2];
    return Math.sqrt(x*x + y*y + z*z);
  }

  function rebuildObjectIndex() {
    st.objectById.clear();
    for (const item of S.objects || []) if (item?.id) st.objectById.set(item.id, item);
  }

  function cellKey(position) {
    return `${Math.floor(position[0] / CELL_SIZE)},${Math.floor(position[1] / CELL_SIZE)},${Math.floor(position[2] / CELL_SIZE)}`;
  }

  function buildSpatialCells() {
    st.cellMap.clear(); st.cells = []; st.sphereData.clear();
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
    report('normal', `Built ${st.cells.length.toLocaleString()} spatial cells for ${st.entries.length.toLocaleString()} indexed objects.`, { cellSize: CELL_SIZE });
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
    if (!object?.ephLargeStreamed || !root) return;
    const entry = st.byId.get(object.ephLargeEntryId);
    if (!entry) return;
    const data = st.sphereData.get(entry.entryId);
    if (data) st.bounds.set(object.id, data);
  }

  function showRoot(object) {
    const viewport = S.viewport;
    if (!viewport || !object || object.visible === false || viewport.objectRoots.has(object.id)) return;
    if (st.active && object.type === 'entity' && object.id !== S.selectedId) return;
    const root = viewport.createObjectRoot(object); if (!root) return;
    viewport.objectGroup.add(root); viewport.objectRoots.set(object.id, root);
    if (object.type === 'prop') st.shownProps.add(object.id);
    cacheBounds(object, root);
    if (S.selectedId === object.id) viewport.select(object.id, false);
  }

  function bind(entry, objects) {
    st.loadedContainers.add(entry.entryId);
    for (const object of objects) {
      const own = st.byDmx.get(String(object.dmxId)) || entry;
      object.ephLargeEntryId = own.entryId;
      object.ephLargeStreamed = true;
      st.loaded.set(own.entryId, object.id);
    }
    if (entry.type === 'entity') {
      const proxyId = `entity:${entry.dmxId || entry.entryId}`;
      const proxyIndex = S.objects.findIndex(item => item.id === proxyId);
      if (proxyIndex >= 0) S.objects.splice(proxyIndex, 1);
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
    if (st.treeTimer || st.preloading) return;
    st.treeTimer = setTimeout(() => {
      st.treeTimer = null;
      if (!st.active) return;
      try { if (S.selectedId && S.selectedId !== 'world') { renderTree?.(); renderProperties?.(); } } catch {}
    }, TREE_DELAY);
  }

  function nextContainers(entries, limit = BATCH) {
    const containers = [], seen = new Set();
    for (const source of entries || []) {
      const container = containerEntry(source);
      if (!container || seen.has(container.entryId) || st.loadedContainers.has(container.entryId) || st.pending.has(container.entryId)) continue;
      seen.add(container.entryId); containers.push(container);
      if (containers.length >= limit) break;
    }
    return containers;
  }

  async function loadEntries(entries, options = {}) {
    if (!st.active || st.pumping) return 0;
    const containers = nextContainers(entries, Number(options.limit) || BATCH);
    if (!containers.length) return 0;
    st.pumping = true; containers.forEach(item => st.pending.add(item.entryId));
    let added = 0;
    try {
      const result = await api.largeMapGetBlocks?.(st.token, containers.map(item => item.entryId));
      if (!st.active || !result?.ok) return 0;
      for (const block of result.blocks || []) {
        const entry = st.byId.get(block.entryId); if (!entry) continue;
        try {
          const parsed = parseBlock(block.text, entry);
          addElement(parsed.element); bind(entry, parsed.objects); added++;
        } catch (error) {
          st.loadedContainers.add(entry.entryId);
          report('error', `Large-map block ${block.entryId} failed.`, error?.stack || error?.message || String(error));
        }
      }
      scheduleTree();
      return added;
    } finally {
      containers.forEach(item => st.pending.delete(item.entryId));
      st.pumping = false;
      if (!st.preloading) schedule();
    }
  }

  function frustum() {
    const viewport = S.viewport;
    viewport.camera.updateMatrixWorld();
    st.projectionMatrix.multiplyMatrices(viewport.camera.projectionMatrix, viewport.camera.matrixWorldInverse);
    return st.frustum.setFromProjectionMatrix(st.projectionMatrix);
  }

  function visibleEntries(view) {
    const output = [];
    for (const cell of st.cells) {
      if (!view.intersectsBox(cell.box)) continue;
      for (const entry of cell.entries) if (entry.visible !== false && view.intersectsSphere(sphere(entry))) output.push(entry);
    }
    return output;
  }

  function initialWorkingSet() {
    const view = frustum();
    const visible = visibleEntries(view);
    const output = [], containers = new Set();
    const add = entry => {
      if (!entry || entry.visible === false) return;
      if (entry.type === 'entity' && !entry.model) return;
      const container = containerEntry(entry);
      if (!container || containers.has(container.entryId)) return;
      containers.add(container.entryId); output.push(entry);
    };
    visible.sort((a,b) => distance(a) - distance(b)).forEach(add);
    if (containers.size < INITIAL_CONTAINER_TARGET) {
      const nearest = st.entries
        .filter(entry => entry?.visible !== false && (entry.type === 'mesh' || (entry.type === 'entity' && entry.model)))
        .sort((a,b) => distance(a) - distance(b));
      for (const entry of nearest) {
        add(entry);
        if (containers.size >= INITIAL_CONTAINER_TARGET) break;
      }
    }
    return output;
  }

  async function runWorkers(items, workers, task, progress) {
    let next = 0, done = 0;
    async function worker() {
      for (;;) {
        const index = next++;
        if (index >= items.length || !st.active) return;
        try { await task(items[index], index); } catch {}
        done++;
        progress?.(done, items.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, workers), Math.max(1, items.length)) }, worker));
  }

  async function warmModels(entries) {
    const viewport = S.viewport;
    if (!viewport?.loadModel) return;
    const initial = new Set((entries || []).map(entry => String(entry?.model || '')).filter(Boolean));
    // Normal CS2 prop models are cheap and commonly reused throughout a map, so
    // warm all of them. Expensive decompiler worldnode draw models are warmed for
    // the initial working set only; once their shared caches exist, later draws
    // become dramatically cheaper.
    for (const entry of st.entries) {
      const model = String(entry?.model || '');
      if (model && !/\/worldnodes\//i.test(`/${model.replace(/\\/g,'/')}`)) initial.add(model);
    }
    const models = [...initial];
    st.modelWarmTarget = models.length; st.modelWarmDone = 0;
    if (!models.length) return;
    loadingStage(`Loading models… 0 / ${models.length.toLocaleString()}`);
    await runWorkers(models, MODEL_WORKERS, model => viewport.loadModel(model), (done,total) => {
      st.modelWarmDone = done;
      if (done === total || done % 5 === 0) loadingStage(`Loading models… ${done.toLocaleString()} / ${total.toLocaleString()}`);
    });
  }

  async function warmMaterials(objects) {
    const viewport = S.viewport;
    if (!viewport?.loadMaterialTexture) return;
    const resources = new Set();
    for (const object of objects || []) {
      if (object?.type !== 'part') continue;
      for (const resource of object.faceMaterials || []) {
        const value = String(resource || '');
        if (value && value !== 'ERROR') resources.add(value);
      }
    }
    const materials = [...resources];
    if (!materials.length) return;
    loadingStage(`Loading textures… 0 / ${materials.length.toLocaleString()}`);
    await runWorkers(materials, MATERIAL_WORKERS, resource => viewport.loadMaterialTexture(resource), (done,total) => {
      if (done === total || done % 10 === 0) loadingStage(`Loading textures… ${done.toLocaleString()} / ${total.toLocaleString()}`);
    });
  }

  async function preloadInitial(entries) {
    const containers = new Set((entries || []).map(entry => containerEntry(entry)?.entryId).filter(Boolean));
    st.preloadTarget = containers.size; st.preloadDone = 0;
    if (!containers.size) return;
    const beforeIds = new Set(st.objectById.keys());
    let guard = 0;
    while (st.active && guard++ < 10000) {
      const remaining = nextContainers(entries, BATCH);
      if (!remaining.length) break;
      loadingStage(`Loading map geometry… ${st.preloadDone.toLocaleString()} / ${st.preloadTarget.toLocaleString()}`);
      const added = await loadEntries(entries, { limit: BATCH });
      st.preloadDone = [...containers].filter(id => st.loadedContainers.has(id)).length;
      if (!added && !st.pending.size) break;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const newObjects = [...st.objectById.values()].filter(object => !beforeIds.has(object.id));
    await warmMaterials(newObjects);
    loadingStage(`Finishing map… ${st.preloadDone.toLocaleString()} regions ready`);
  }

  function refresh() {
    if (!st.active || st.preloading || !S.viewport?.camera) return;
    const started = performance.now(), view = frustum();
    const entries = visibleEntries(view), meshes = [], props = [];

    for (const entry of entries) {
      const loadedId = st.loaded.get(entry.entryId);
      if (entry.type === 'entity') {
        const proxyId = `entity:${entry.dmxId || entry.entryId}`;
        const object = loadedId ? st.objectById.get(loadedId) : st.objectById.get(proxyId);
        if (object?.type === 'prop' && !S.viewport.objectRoots.has(object.id)) props.push({ entry, object });
        else if (object?.type === 'entity' && object.id === S.selectedId && !S.viewport.objectRoots.has(object.id)) showRoot(object);
      } else if (!loadedId && !st.loadedContainers.has(containerEntry(entry)?.entryId) && !st.pending.has(containerEntry(entry)?.entryId || entry.entryId)) meshes.push(entry);
    }

    const selected = st.objectById.get(S.selectedId);
    if (selected?.ephLargeProxy) {
      const entry = st.byId.get(selected.ephLargeEntryId);
      if (entry) loadEntries([entry]);
    }

    const candidates = [
      ...meshes.map(entry => ({ kind: 'mesh', entry, d: distance(entry) })),
      ...props.map(item => ({ kind: 'prop', ...item, d: distance(item.entry) })),
    ].sort((a,b) => a.d - b.d);
    const toLoad = [];
    let count = 0;
    for (const candidate of candidates) {
      if (count >= BATCH) break;
      if (candidate.kind === 'prop') showRoot(candidate.object); else toLoad.push(candidate.entry);
      count++;
    }
    if (toLoad.length) loadEntries(toLoad);

    // V29 intentionally does NOT evict loaded geometry when it leaves the
    // camera frustum. Three.js already frustum-culls draw calls. Keeping the
    // object/root resident prevents the destructive unload -> parse -> model
    // reload cycle that caused visible popping whenever the camera turned.
    st.refreshCount++;
    st.lastRefreshMs = performance.now() - started;
    if (st.refreshCount <= 3 || st.refreshCount % 300 === 0) {
      report(st.lastRefreshMs > 8 ? 'warning' : 'normal', `Visibility refresh checked ${st.cells.length} cells / ${entries.length} in-view entries in ${st.lastRefreshMs.toFixed(1)} ms.`, {
        totalEntries: st.entries.length, resident: st.loaded.size, pending: st.pending.size,
      });
    }
  }

  function schedule() {
    if (!st.active || st.preloading || st.refreshTimer) return;
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
    const c = entrySphereData(entry).c;
    const point = new THREE.Vector3(c[0], c[1], c[2]);
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
    st.active = false; st.preloading = false;
    const tiny = VMAP.createEmptyDocument();
    const ok = await rawLoad({ ...project, ephSkipModelWarmup: true }, { ...(ui || {}), vmapText: VMAP.stringify(tiny) });
    if (!ok) return false;
    st.active = true; st.preloading = true; st.token = decoded.largeMapToken;
    st.entries = Array.isArray(decoded.largeMapEntries) ? decoded.largeMapEntries : [];
    st.byId = new Map(st.entries.map(item => [item.entryId, item]));
    st.byDmx = new Map(st.entries.filter(item => item.dmxId).map(item => [String(item.dmxId), item]));
    st.loaded.clear(); st.loadedContainers.clear(); st.pending.clear(); st.bounds.clear(); st.shownProps.clear(); st.sphereData.clear();
    S.project = { ...project, ephLargeMap: true, ephLargeMapToken: st.token, ephLargeMapStats: { meshCount: decoded.meshCount, entityCount: decoded.entityCount, decodedBytes: decoded.decodedBytes } };
    S.doc = tiny; S.objects = VMAP.extractObjects(tiny).map(ensureObject);
    for (const entry of st.entries) if (entry.type === 'entity') S.objects.push(proxy(entry));
    rebuildObjectIndex(); buildSpatialCells();
    S.selectedId = 'world'; S.dirty = false; installViewport(); markDirty(); installSave();
    if (S.viewport) { S.viewport.objects = S.objects; S.viewport.clearObjects(); initialCamera(); }

    const working = initialWorkingSet();
    report('normal', 'Preloading initial stable working set before editor handoff.', {
      containers: new Set(working.map(entry => containerEntry(entry)?.entryId).filter(Boolean)).size,
      indexed: st.entries.length,
    });
    try {
      await warmModels(working);
      await preloadInitial(working);
    } catch (error) {
      report('warning', 'Initial preload encountered an error; keeping successfully loaded content resident.', error?.stack || error?.message || String(error));
    }

    st.preloading = false;
    renderAll?.(); updateTitle?.(); schedule();
    await api.autosave?.({ project: S.project, uiState: window.uiSnapshot?.() || null });
    report('normal', 'Large map ready. Loaded geometry is now persistent and camera movement never evicts it.', {
      entries: st.entries.length, cells: st.cells.length, resident: st.loaded.size,
      preloadedContainers: st.loadedContainers.size, modelsWarmed: st.modelWarmDone, pixelRatio: 1,
    });
    return true;
  }

  async function close() {
    if (!st.active) return;
    st.active = false; st.preloading = false; clearTimeout(st.refreshTimer); clearTimeout(st.treeTimer);
    try { await api.largeMapRelease?.(st.token); } catch {}
    try { if (S.viewport && st.oldPixelRatio != null) { S.viewport.renderer.setPixelRatio(st.oldPixelRatio); S.viewport.resize?.(); } } catch {}
    st.token = null; st.entries = []; st.byId.clear(); st.byDmx.clear(); st.loaded.clear(); st.loadedContainers.clear(); st.pending.clear();
    st.bounds.clear(); st.objectById.clear(); st.shownProps.clear(); st.sphereData.clear(); st.cells = []; st.cellMap.clear();
  }

  window.EPH_LARGE_STREAM = {
    open, close, refresh, save: saveLarge,
    active: () => st.active,
    state: () => ({
      active: st.active, preloading: st.preloading, token: st.token, entries: st.entries.length,
      loaded: st.loaded.size, pending: st.pending.size, cells: st.cells.length,
      preloadTarget: st.preloadTarget, preloadDone: st.preloadDone,
      modelWarmTarget: st.modelWarmTarget, modelWarmDone: st.modelWarmDone,
      refreshMs: Number(st.lastRefreshMs.toFixed(2)),
    }),
  };
})();
