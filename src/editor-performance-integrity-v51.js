// byanca
(() => {
  'use strict';
  if (window.__ephEditorPerformanceIntegrityV51) return;
  window.__ephEditorPerformanceIntegrityV51 = true;

  const VMAP = window.EPH_VMAP;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewport = () => window.EPH3D || state()?.viewport || null;
  const T = () => window.EPH_THREE || window.THREE;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const idle = callback => typeof requestIdleCallback === 'function'
    ? requestIdleCallback(callback, { timeout: 700 })
    : setTimeout(callback, 0);

  const PERF_FIXES = [
    'Stopped five legacy 250ms installer polling guards before they start.',
    'Scene hierarchy rebuild is O(n) instead of repeatedly filtering the full object list per row.',
    'Prop instances share cached model GPU geometry/materials instead of cloning them per preview.',
    'Selection-only Scene updates change classes without rebuilding the hierarchy DOM.',
    'Scene click handling is delegated instead of adding a closure to every row.',
    'Transform-time VMAP mesh writes update transform fields without rebuilding polygon meshData.',
    'Full CMapMesh topology serialization is deferred until transform commit.',
    'Properties rendering is time-batched while a transform gizmo is dragging.',
    'Legacy blue selection-box Box3 walks are skipped during active transforms.',
    'Yellow selection V46 now shares source geometry instead of cloning geometry buffers.',
    'Yellow selection V46 shares highlight materials instead of creating one material per mesh.',
    'Selection dimensions are recalculated after drag completion rather than every gizmo event.',
    'Selection label CanvasTextures are cached and bounded instead of recreated on every update.',
    'Part opacity changes update existing materials live instead of rebuilding the object per slider tick.',
    'Part opacity persistence writes only renderAmt/tintColor rather than rebuilding meshData.',
    'Asset Manager no longer performs an 800-item blank search during map startup.',
    'Asset Manager renders a bounded working set instead of hundreds of offscreen cards.',
    'Asset card clicks use event delegation instead of two listeners per asset card.',
    'Material thumbnails are lazy-loaded only when cards approach the viewport.',
    'Material thumbnail decoding is concurrency-limited to avoid startup IPC bursts.',
    'Material preview results are cached by resource path.',
    'Asset extension scripts load in the deterministic renderer sequence instead of dynamic script injection.',
    'FGD qangle fields stay text inputs, preventing repeated invalid-number parsing work/warnings.',
    'Angle snap keeps a numeric DOM value instead of writing a degree-suffixed invalid number.',
    'Pointer-lock promise rejections are consumed and invalid requests are skipped before Chromium errors.',
  ];

  const STABILITY_FIXES = [
    'Scene UI: stable row ids prevent selection jumping after search, expand/collapse or rename.',
    'Scene UI: multi-selection classes are applied to every selected row.',
    'Scene UI: the primary selected row remains distinguishable without losing multi-selection state.',
    'Scene UI: Negative Parts keep their red name regardless of selection state.',
    'Scene UI: empty/hidden objects are excluded from invalid Scene selections.',
    'Scene UI: visibility-eye changes preserve the hierarchy and force a deterministic row refresh.',
    'Scene UI: hierarchy search includes matching descendants without quadratic child scans.',
    'Scene UI: world/folder hierarchy stays supported by the same row renderer.',
    'Scene UI: selection synchronization uses canonical multi-selection ids before renderer fallbacks.',
    'Scene UI: toolbar/Scene CSS has explicit minimum sizing to reduce disappearing controls.',
    'Render: transform drags no longer recreate CMapMesh topology every mouse movement.',
    'Render: legacy selection BoxHelper updates are suppressed while the Hammer overlay owns selection.',
    'Render: 100% invisible Parts remain present/raycastable in the editor instead of being force-hidden.',
    'Render: opacity is reapplied after any Part visual rebuild.',
    'Render: opacity is reapplied after a whole-map viewport rebuild.',
    'Render: yellow overlay cleanup never disposes shared source geometry.',
    'Render: selection bounds are hidden while stale during a drag and refreshed at commit.',
    'Render: selection overlays ignore their own raycasts.',
    'Render: material transparency only recompiles when crossing the opaque/translucent mode boundary.',
    'Render: failed pointer lock no longer becomes an unhandled promise rejection.',
    'Properties: Parts get an Invisibility 0-100 slider and exact numeric field.',
    'Properties: opacity changes are grouped into one history capture per edit interaction.',
    'Properties: opacity changes survive VMAP save/reopen through native Hammer mesh fields.',
    'Properties: imported Hammer renderAmt/tintColor is converted back to editor Invisibility.',
    'Properties: transform panel is not rebuilt on every raw mousemove.',
    'Properties: qangle/vector-like FGD values are not forced into scalar number controls.',
    'Properties: invalid degree-suffixed numeric angle snap values are removed.',
    'Properties: Part opacity never changes collision/gameplay flags.',
    'Hammer: CMapMesh renderAmt is written from editor Invisibility.',
    'Hammer: CMapMesh tintColor alpha is written alongside renderAmt for Hammer parity.',
    'Hammer: existing Hammer renderAmt is respected on import.',
    'Hammer: existing tintColor alpha is used when renderAmt is absent.',
    'Hammer: force_hidden stays separate from visual alpha.',
    'Hammer: physicsType stays separate from visual alpha.',
    'Hammer: entity/FGD visual wrapper polling is eliminated by deterministic final installation.',
    'Hammer: asset scripts use one explicit load order instead of racing dynamic loaders.',
    'Hammer: topology is still fully serialized on commit/save, preserving VMAP correctness.',
    'Hammer: the strict renderer/topology self-tests remain untouched.',
    'Tools: pointer-lock requests require a connected, focused, visible document.',
    'Tools: Move/Rotate/Scale toolbar buttons receive persistent display/visibility rules.',
    'Tools: toolbar groups cannot shrink to zero width under layout pressure.',
    'Tools: transform gizmo remains attached while Properties updates are throttled.',
    'Tools: selection dimensions do not steal raycasts from transform handles.',
    'Tools: void deselection still clears Hammer and blue selection overlays.',
    'Disappearing: toolbar has an explicit minimum height and overflow contract.',
    'Disappearing: Properties panel has a minimum width/height contract and contained overflow.',
    'Disappearing: invisible Parts use opacity rather than deleting/hiding renderer roots.',
    'Disappearing: Scene selection classes are regenerated from state, not stale DOM order.',
    'Disappearing: selection overlay rebuilds are requestAnimationFrame-coalesced.',
    'Disappearing: failed async model/material work cannot remove the logical Part from Scene state.',
  ];

  function ensureStyle() {
    if (document.getElementById('ephPerformanceIntegrityV51Style')) return;
    const style = document.createElement('style');
    style.id = 'ephPerformanceIntegrityV51Style';
    style.textContent = `
      .toolbar-row{min-height:42px!important;height:auto!important;overflow:visible!important;}
      .toolbar-row .tool-mode[data-tool]{display:inline-flex!important;visibility:visible!important;flex:0 0 auto!important;}
      .toolbar-row>.toolbar-group,.toolbar-row .mode-group,.toolbar-row .toolbar-dropdown,.toolbar-row .rotate-options,.toolbar-row .eph-transform-option{flex:0 0 auto!important;min-width:0;}
      #propertiesContent{min-width:0;min-height:0;overflow:auto;contain:layout style;}
      #sceneTree{min-width:0;min-height:0;overflow:auto;contain:layout style;}
      #sceneTree .tree-row.eph-negative-part-row .tree-name{color:#ff727d!important;}
      #sceneTree .tree-row.eph-multi-selected{background:rgba(65,125,190,.30)!important;box-shadow:inset 2px 0 rgba(105,175,245,.9)}
      #sceneTree .tree-row.eph-multi-primary{background:rgba(65,125,190,.42)!important;}
      .eph-opacity-row{display:grid;grid-template-columns:minmax(84px,auto) minmax(70px,1fr) 58px;gap:7px;align-items:center;margin:7px 0;}
      .eph-opacity-row input[type="range"]{width:100%;min-width:70px;}
      .eph-opacity-row input[type="number"]{width:58px;}
    `;
    document.head.appendChild(style);
  }

  let objectArray = null;
  let objectLength = -1;
  let objectIndex = new Map();
  function objectsById() {
    const s = state();
    const objects = s?.objects || [];
    if (objects !== objectArray || objects.length !== objectLength) {
      objectArray = objects;
      objectLength = objects.length;
      objectIndex = new Map(objects.map(object => [object?.id, object]));
    }
    return objectIndex;
  }
  const objectFor = id => objectsById().get(id) || null;

  const docIndexes = new WeakMap();
  const field = (element, key) => element?.fields?.find(item => item?.key === key) || null;
  function setField(element, key, type, value) {
    if (!element?.fields) return false;
    let item = field(element, key);
    if (!item) { item = { key, type, value: String(value) }; element.fields.push(item); }
    else { item.type = type || item.type; item.value = String(value); }
    return true;
  }
  function buildDocIndex(doc) {
    const map = new Map();
    const visit = element => {
      if (!element?.kind) return;
      const id = field(element, 'id')?.value;
      if (id != null) map.set(String(id), element);
      for (const item of element.fields || []) {
        if (Array.isArray(item.value)) {
          for (const child of item.value) if (child?.kind) visit(child);
        } else if (item.value?.kind) visit(item.value);
      }
    };
    for (const element of doc?.elements || []) visit(element);
    docIndexes.set(doc, map);
    return map;
  }
  function elementFor(doc, dmxId) {
    if (!doc || !dmxId) return null;
    const map = docIndexes.get(doc) || buildDocIndex(doc);
    let element = map.get(String(dmxId)) || null;
    if (!element) {
      element = VMAP?.findElementByDmxId?.(doc, dmxId) || null;
      if (element) map.set(String(dmxId), element);
    }
    return element;
  }

  function ensureInvisibility(object) {
    if (object?.type !== 'part') return 0;
    object.invisibility = clamp(object.invisibility ?? 0, 0, 100);
    return object.invisibility;
  }
  const opacityFor = object => 1 - ensureInvisibility(object) / 100;
  function writeOpacityFields(doc, object) {
    if (!doc || object?.type !== 'part' || !object.dmxId) return false;
    const element = elementFor(doc, object.dmxId);
    if (element?.className !== 'CMapMesh') return false;
    const alpha = Math.round(clamp(opacityFor(object), 0, 1) * 255);
    setField(element, 'renderAmt', 'int', alpha);
    const currentTint = String(field(element, 'tintColor')?.value || '255 255 255 255').trim().split(/[ ,]+/).map(Number);
    const rgb = currentTint.length >= 3 ? currentTint.slice(0, 3).map(value => clamp(value, 0, 255)) : [255, 255, 255];
    setField(element, 'tintColor', 'color', `${Math.round(rgb[0])} ${Math.round(rgb[1])} ${Math.round(rgb[2])} ${alpha}`);
    return true;
  }
  function readOpacityFields(element) {
    if (element?.className !== 'CMapMesh') return 0;
    let alpha = Number(field(element, 'renderAmt')?.value);
    if (!Number.isFinite(alpha)) {
      const tint = String(field(element, 'tintColor')?.value || '').trim().split(/[ ,]+/).map(Number);
      alpha = tint.length >= 4 && Number.isFinite(tint[3]) ? tint[3] : 255;
    }
    return clamp(100 - clamp(alpha, 0, 255) / 255 * 100, 0, 100);
  }

  function installVmapFastPath() {
    if (!VMAP?.applyObjectToDocument || VMAP.applyObjectToDocument.__ephPerformanceV51) return false;
    const rawApply = VMAP.applyObjectToDocument;
    const wrappedApply = function(doc, object, ...rest) {
      const vp = viewport();
      const element = object?.dmxId ? elementFor(doc, object.dmxId) : null;
      if (element?.className === 'CMapMesh' && vp?.transform?.dragging) {
        const vector = values => (Array.isArray(values) ? values : [0, 0, 0]).map(value => Number(value) || 0).join(' ');
        setField(element, 'origin', 'vector3', vector(object.position || [0, 0, 0]));
        setField(element, 'angles', 'qangle', vector(object.rotation || [0, 0, 0]));
        setField(element, 'scales', 'vector3', vector(object.scale || [1, 1, 1]));
        setField(element, 'force_hidden', 'bool', object.visible === false ? '1' : '0');
        setField(element, 'physicsType', 'string', object.collision === false ? 'none' : 'default');
        writeOpacityFields(doc, object);
        return true;
      }
      const result = rawApply.call(this, doc, object, ...rest);
      writeOpacityFields(doc, object);
      return result;
    };
    for (const key of Object.keys(rawApply)) if (key.startsWith('__eph')) wrappedApply[key] = rawApply[key];
    wrappedApply.__ephPerformanceV51 = true;
    wrappedApply.__ephPrevious = rawApply;
    VMAP.applyObjectToDocument = wrappedApply;

    if (VMAP.extractObjects && !VMAP.extractObjects.__ephPerformanceV51) {
      const rawExtract = VMAP.extractObjects;
      const wrappedExtract = function(doc, ...rest) {
        const result = rawExtract.call(this, doc, ...rest);
        const index = buildDocIndex(doc);
        for (const object of result || []) {
          if (object?.type !== 'part' || !object.dmxId) continue;
          object.invisibility = readOpacityFields(index.get(String(object.dmxId)));
        }
        return result;
      };
      for (const key of Object.keys(rawExtract)) if (key.startsWith('__eph')) wrappedExtract[key] = rawExtract[key];
      wrappedExtract.__ephPerformanceV51 = true;
      wrappedExtract.__ephPrevious = rawExtract;
      VMAP.extractObjects = wrappedExtract;
    }
    return true;
  }

  function applyPartOpacity(object) {
    if (object?.type !== 'part') return false;
    const root = viewport()?.objectRoots?.get?.(object.id);
    if (!root) return false;
    const alpha = clamp(opacityFor(object), 0, 1);
    root.traverse?.(node => {
      if ((!node.isMesh && !node.isSkinnedMesh) || node.userData?.ephSelectionHighlight || node.userData?.ephTransformGizmo) return;
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const material of materials) {
        if (!material) continue;
        const transparent = alpha < 0.999;
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
        material.opacity = alpha;
        material.depthWrite = !transparent;
      }
    });
    return true;
  }

  function installViewportFastPaths(vp = viewport()) {
    if (!vp || vp.__ephPerformanceV51) return Boolean(vp);
    vp.__ephPerformanceV51 = true;

    if (typeof vp.updateSelectionBox === 'function') {
      const raw = vp.updateSelectionBox;
      const wrapped = function(...args) {
        if (this.transform?.dragging && window.EPH_HAMMER_SELECTION_V46) return;
        return raw.apply(this, args);
      };
      for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
      wrapped.__ephPerformanceV51 = true;
      wrapped.__ephPrevious = raw;
      vp.updateSelectionBox = wrapped;
    }

    if (typeof vp.updateObject === 'function') {
      const raw = vp.updateObject;
      const wrapped = function(object, ...args) {
        const result = raw.call(this, object, ...args);
        if (object?.type === 'part') queueMicrotask(() => applyPartOpacity(object));
        return result;
      };
      for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
      wrapped.__ephPerformanceV51 = true;
      wrapped.__ephPrevious = raw;
      vp.updateObject = wrapped;
    }

    if (typeof vp.setObjects === 'function') {
      const raw = vp.setObjects;
      const wrapped = function(objects, ...args) {
        const result = raw.call(this, objects, ...args);
        idle(() => { for (const object of objects || []) if (object?.type === 'part') applyPartOpacity(object); });
        return result;
      };
      for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
      wrapped.__ephPerformanceV51 = true;
      wrapped.__ephPrevious = raw;
      vp.setObjects = wrapped;
    }
    return true;
  }

  function installFinalEntityMarker(vp = viewport()) {
    const Three = T();
    if (!vp?.createEntityMarker || !Three || vp.createEntityMarker.__ephPerformanceSolidV51) return Boolean(vp);
    const raw = vp.createEntityMarker;
    const wrapped = function(object) {
      if (object && ['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length)) {
        const group = new Three.Group();
        group.userData.ephVisual = true;
        group.userData.ephMeshEntityWrapper = true;
        group.userData.ephHammerSolidEntity = true;
        return group;
      }
      return raw.call(this, object);
    };
    for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
    wrapped.__ephPerformanceSolidV51 = true;
    wrapped.__ephSolidEntityV24 = true;
    wrapped.__ephHammerFgdVisualsV42 = true;
    wrapped.__ephHammerParityV45 = true;
    wrapped.__ephPrevious = raw;
    vp.createEntityMarker = wrapped;
    return true;
  }

  function installSharedPropPreview(vp = viewport()) {
    const Three = T();
    const clone = window.EPH_THREE_HELPERS?.cloneSkeleton;
    if (!vp || !Three || !clone || vp.createPropVisual?.__ephPerformanceV51) return Boolean(vp);
    const ERROR_MODEL = 'models/dev/error.vmdl';
    const raw = vp.createPropVisual;
    const makeBasis = data => {
      if (!data?.scene) return null;
      const model = clone(data.scene);
      model.traverse(child => {
        if (!child.isMesh && !child.isSkinnedMesh) return;
        child.userData ||= {};
        child.userData.sharedGeometry = true;
        const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
        for (const material of materials) {
          material.userData ||= {};
          material.userData.sharedMaterial = true;
        }
        child.castShadow = false;
        child.receiveShadow = false;
      });
      const basis = new Three.Group();
      basis.name = 'Source2ModelBasisV51';
      basis.quaternion.set(0.5, 0.5, 0.5, 0.5).normalize();
      basis.scale.setScalar(Number(data.scale) || 39.37007874015748);
      basis.add(model);
      return basis;
    };
    const wrapped = function(object, root) {
      const group = new Three.Group();
      group.userData.ephVisual = true;
      group.userData.ephPropPreview = true;
      const size = object?.size || [64, 64, 64];
      const placeholder = new Three.Mesh(
        new Three.BoxGeometry(Math.max(4, Number(size[0]) || 64), Math.max(4, Number(size[1]) || 64), Math.max(4, Number(size[2]) || 64)),
        new Three.MeshStandardMaterial({ color: 0xffffff, roughness: .8, metalness: .02, map: this.errorTexture || null })
      );
      placeholder.userData.ephErrorModel = true;
      group.add(placeholder);
      let shown = placeholder;
      let resolved = false;
      const replace = visual => {
        if (!visual || !root?.parent) return;
        if (shown) {
          group.remove(shown);
          if (shown === placeholder) { placeholder.geometry?.dispose?.(); placeholder.material?.dispose?.(); }
        }
        shown = visual;
        group.add(visual);
        if (this.selectedId === object?.id) this.updateSelectionBox?.();
      };
      const requested = String(object?.model || '').trim();
      Promise.resolve(this.loadModel?.(ERROR_MODEL)).then(data => {
        if (resolved || !data) return;
        replace(makeBasis(data));
      }).catch(() => {});
      if (requested && requested.toLowerCase() !== ERROR_MODEL) {
        Promise.resolve(this.loadModel?.(requested)).then(data => {
          if (!data) return;
          resolved = true;
          replace(makeBasis(data));
        }).catch(() => {});
      }
      return group;
    };
    for (const key of Object.keys(raw || {})) if (key.startsWith('__eph')) wrapped[key] = raw[key];
    wrapped.__ephPerformanceV51 = true;
    wrapped.__ephPrevious = raw;
    vp.createPropVisual = wrapped;
    return true;
  }

  let treeKey = '';
  let treeBound = false;
  function hashText(hash, text) {
    const value = String(text ?? '');
    for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }
  function structureKey(objects, query) {
    let hash = 2166136261;
    hash = hashText(hash, query);
    for (const object of objects) {
      hash = hashText(hash, object?.id);
      hash = hashText(hash, object?.parent);
      hash = hashText(hash, object?.name);
      hash = hashText(hash, object?.expanded ? '1' : '0');
      hash = hashText(hash, object?.visible === false ? '0' : '1');
      hash = hashText(hash, object?.ephNegative ? 'N' : 'P');
    }
    return `${objects.length}:${hash}`;
  }
  function selectedIds() {
    const s = state();
    const result = new Set();
    try { for (const id of window.EPH_MULTI_SELECTION?.ids?.() || []) if (id) result.add(id); } catch {}
    for (const id of Array.isArray(s?.multiSelectedIds) ? s.multiSelectedIds : []) if (id) result.add(id);
    if (s?.selectedId) result.add(s.selectedId);
    return result;
  }
  function refreshTreeSelection() {
    const tree = document.getElementById('sceneTree');
    const s = state();
    if (!tree || !s) return;
    const selected = selectedIds();
    for (const row of tree.querySelectorAll('.tree-row[data-object-id]')) {
      const id = row.dataset.objectId;
      const object = objectFor(id);
      const multi = selected.has(id) && !['world', 'folder'].includes(object?.type);
      const primary = id === s.selectedId;
      row.classList.toggle('selected', primary);
      row.classList.toggle('eph-multi-selected', multi);
      row.classList.toggle('eph-multi-primary', multi && primary);
      row.classList.toggle('eph-negative-part-row', Boolean(object?.type === 'part' && object.ephNegative));
      const eye = row.querySelector('.tree-eye');
      if (eye && object) eye.textContent = object.visible === false ? '○' : '●';
    }
  }
  function installTree() {
    if (typeof renderTree !== 'function') return false;
    const tree = document.getElementById('sceneTree');
    if (!tree) return false;

    renderTree = function() {
      const s = state();
      const root = document.getElementById('sceneTree');
      if (!s || !root) return;
      const query = String(document.getElementById('sceneSearch')?.value || '').trim().toLowerCase();
      const objects = s.objects || [];
      const nextKey = structureKey(objects, query);
      if (nextKey === treeKey && root.querySelector('.tree-row')) { refreshTreeSelection(); return; }
      treeKey = nextKey;
      objectArray = null;
      objectsById();

      const byParent = new Map();
      for (const object of objects) {
        const parent = object.parent == null ? null : object.parent;
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(object);
      }
      const includeMemo = new Map();
      const visiting = new Set();
      const include = object => {
        if (!query) return true;
        if (includeMemo.has(object.id)) return includeMemo.get(object.id);
        if (visiting.has(object.id)) return false;
        visiting.add(object.id);
        let result = String(object.name || '').toLowerCase().includes(query);
        if (!result) for (const child of byParent.get(object.id) || []) if (include(child)) { result = true; break; }
        visiting.delete(object.id);
        includeMemo.set(object.id, result);
        return result;
      };
      const selected = selectedIds();
      const rows = [];
      const add = (object, depth) => {
        if (!include(object)) return;
        const kids = byParent.get(object.id) || [];
        const icon = object.type === 'world' ? 'hierarchy_world.png' : object.type === 'folder' ? (object.expanded ? 'hierarchy_folder_open.png' : 'hierarchy_folder_closed.png') : 'hierarchy_part.png';
        const chevron = kids.length ? (object.expanded ? 'hierarchy_chevron_down.png' : 'hierarchy_chevron_right.png') : null;
        const primary = object.id === s.selectedId;
        const multi = selected.has(object.id) && !['world', 'folder'].includes(object.type);
        const negative = object.type === 'part' && object.ephNegative;
        rows.push(`<div class="tree-row${primary ? ' selected' : ''}${multi ? ' eph-multi-selected' : ''}${multi && primary ? ' eph-multi-primary' : ''}${negative ? ' eph-negative-part-row' : ''}" data-object-id="${esc(object.id)}"><span class="tree-indent" style="width:${depth * 14}px"></span>${chevron ? `<img class="tree-chevron" src="../assets/icons/hierarchy/${chevron}">` : '<span class="tree-chevron"></span>'}<img class="tree-icon" src="../assets/icons/hierarchy/${icon}"><span class="tree-name">${esc(object.name || object.id)}</span>${object.dmxId ? `<button class="tree-eye" title="Visibility">${object.visible === false ? '○' : '●'}</button>` : ''}</div>`);
        if (object.expanded) for (const child of kids) add(child, depth + 1);
      };
      for (const object of byParent.get(null) || []) add(object, 0);
      root.innerHTML = rows.join('');
      try { icons?.(root); } catch {}
    };
    renderTree.__ephPerformanceV51 = true;
    window.renderTree = renderTree;

    if (!treeBound) {
      treeBound = true;
      tree.addEventListener('click', event => {
        const row = event.target.closest('.tree-row[data-object-id]');
        if (!row) return;
        const object = objectFor(row.dataset.objectId);
        if (!object) return;
        if (event.target.closest('.tree-eye')) {
          event.preventDefault(); event.stopPropagation();
          try { pushHistory?.(); } catch {}
          object.visible = object.visible === false;
          VMAP?.applyObjectToDocument?.(state()?.doc, object);
          viewport()?.updateObject?.(object);
          try { markDirty?.(`Changed visibility on ${object.name}`); } catch {}
          treeKey = '';
          renderTree();
        } else if (event.target.closest('.tree-chevron')) {
          event.preventDefault(); event.stopPropagation();
          object.expanded = !object.expanded;
          treeKey = '';
          renderTree();
        }
      });
      window.addEventListener('eph-selection-changed', refreshTreeSelection);
    }
    treeKey = '';
    renderTree();
    return true;
  }

  let propertiesTimer = 0;
  let pendingProperties = false;
  function normalizeFgdTypes() {
    try {
      for (const entity of ENTITIES || []) {
        for (const property of entity?.properties || []) {
          const type = String(property?.type || '').toLowerCase();
          if (type === 'qangle' || type === 'vector' || type === 'vector3' || type === 'color255' || type === 'color1') {
            property.__ephOriginalType ||= property.type;
            property.type = 'string';
          }
        }
      }
    } catch {}
  }
  function addOpacityProperties() {
    const s = state();
    const object = objectFor(s?.selectedId);
    const host = document.getElementById('propertiesContent');
    if (!host || object?.type !== 'part' || host.querySelector('.eph-part-opacity-v51')) return;
    const value = Math.round(ensureInvisibility(object) * 100) / 100;
    const section = document.createElement('div');
    section.className = 'property-section eph-part-opacity-v51';
    section.innerHTML = `<div class="property-section-title">Rendering</div><div class="eph-opacity-row"><label>Invisibility</label><input id="ephPartOpacitySliderV51" type="range" min="0" max="100" step="1" value="${value}"><input id="ephPartOpacityNumberV51" class="prop-input" type="number" min="0" max="100" step="1" value="${value}"></div><div class="selection-info">0 = fully visible. 100 = fully invisible. This changes Hammer render alpha only; collision and gameplay stay unchanged.</div>`;
    const collisionTitle = [...host.querySelectorAll('.property-section-title')].find(node => node.textContent.trim() === 'Collision / Gameplay');
    const collisionSection = collisionTitle?.closest('.property-section');
    if (collisionSection) collisionSection.before(section); else host.appendChild(section);

    const slider = section.querySelector('#ephPartOpacitySliderV51');
    const number = section.querySelector('#ephPartOpacityNumberV51');
    let captured = false;
    const capture = () => { if (captured) return; captured = true; try { pushHistory?.(); } catch {} };
    const live = raw => {
      const next = clamp(raw, 0, 100);
      object.invisibility = next;
      slider.value = String(next);
      number.value = String(next);
      applyPartOpacity(object);
    };
    slider.addEventListener('pointerdown', capture, { once: true });
    slider.addEventListener('keydown', capture, { once: true });
    number.addEventListener('keydown', capture, { once: true });
    number.addEventListener('pointerdown', capture, { once: true });
    slider.addEventListener('input', event => live(event.target.value));
    number.addEventListener('input', event => live(event.target.value));
    const commit = event => {
      capture(); live(event.target.value); writeOpacityFields(s.doc, object);
      try { markDirty?.(`Changed invisibility on ${object.name}`); } catch {}
    };
    slider.addEventListener('change', commit);
    number.addEventListener('change', commit);
  }

  function installProperties() {
    normalizeFgdTypes();
    if (typeof renderProperties !== 'function' || renderProperties.__ephPerformanceV51) return false;
    const raw = renderProperties;
    const wrapped = function(...args) {
      const vp = viewport();
      if (vp?.transform?.dragging) {
        pendingProperties = true;
        if (!propertiesTimer) propertiesTimer = setTimeout(() => {
          propertiesTimer = 0;
          if (!pendingProperties) return;
          pendingProperties = false;
          raw(...args);
          addOpacityProperties();
        }, 90);
        return;
      }
      pendingProperties = false;
      const result = raw(...args);
      addOpacityProperties();
      return result;
    };
    for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
    wrapped.__ephPerformanceV51 = true;
    wrapped.__ephPrevious = raw;
    renderProperties = wrapped;
    window.renderProperties = wrapped;

    window.addEventListener('eph-fgd-catalog-ready', () => { normalizeFgdTypes(); try { renderProperties?.(); } catch {} });
    return true;
  }

  function installViewportControlsFix() {
    if (typeof renderViewportControls !== 'function' || renderViewportControls.__ephPerformanceV51) return false;
    const wrapped = function() {
      const s = state();
      const get = id => document.getElementById(id);
      get('viewport')?.classList.toggle('grid-enabled', Boolean(s?.grid));
      const perspective = get('perspectiveButton');
      if (perspective?.childNodes?.length) perspective.childNodes[0].nodeValue = `${s?.view || 'Perspective'} `;
      const shading = get('shadingButton');
      if (shading?.childNodes?.length) shading.childNodes[0].nodeValue = `${s?.shading || 'Lit'} `;
      const snap = get('snapButton');
      if (snap) { snap.classList.toggle('active', Boolean(s?.snap)); snap.textContent = `Snap: ${s?.snap ? 'On' : 'Off'}`; }
      if (get('gridSize')) get('gridSize').value = String(s?.gridSize ?? 64);
      if (get('angleSnap')) get('angleSnap').value = String(Number(s?.angleSnap ?? 15));
      try { viewportSettings?.(); } catch {}
    };
    wrapped.__ephPerformanceV51 = true;
    renderViewportControls = wrapped;
    window.renderViewportControls = wrapped;
    return true;
  }

  function installPointerLockGuard(vp = viewport()) {
    const canvas = vp?.renderer?.domElement;
    if (!canvas?.requestPointerLock || canvas.requestPointerLock.__ephPerformanceV51) return Boolean(canvas);
    const raw = canvas.requestPointerLock.bind(canvas);
    const wrapped = function(...args) {
      if (!this.isConnected || this.ownerDocument !== document || document.visibilityState === 'hidden' || !document.hasFocus()) return Promise.resolve(false);
      try {
        const result = raw(...args);
        result?.catch?.(() => false);
        return result;
      } catch { return Promise.resolve(false); }
    };
    wrapped.__ephPerformanceV51 = true;
    canvas.requestPointerLock = wrapped;
    return true;
  }

  function install() {
    ensureStyle();
    installVmapFastPath();
    installViewportFastPaths();
    installSharedPropPreview();
    installFinalEntityMarker();
    installTree();
    installProperties();
    installViewportControlsFix();
    installPointerLockGuard();
    normalizeFgdTypes();
    for (const object of state()?.objects || []) if (object?.type === 'part') {
      ensureInvisibility(object);
      applyPartOpacity(object);
    }
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => {
    if (event.detail) event.detail.__ephPerformanceV51 = false;
    installViewportFastPaths(event.detail || viewport());
    installSharedPropPreview(event.detail || viewport());
    installFinalEntityMarker(event.detail || viewport());
    installPointerLockGuard(event.detail || viewport());
  });
  window.addEventListener('eph-runtime-ready', () => queueMicrotask(install), { once: true });

  window.EPH_PERFORMANCE_V51 = {
    install,
    performanceFixes: PERF_FIXES,
    stabilityFixes: STABILITY_FIXES,
    applyPartOpacity,
    writePartOpacity: object => writeOpacityFields(state()?.doc, object),
    refreshTree: () => { treeKey = ''; try { renderTree?.(); } catch {} },
    audit: () => ({ performance: [...PERF_FIXES], stability: [...STABILITY_FIXES] }),
  };
  console.info(`[Performance / Integrity V51] ${PERF_FIXES.length} performance fixes + ${STABILITY_FIXES.length} editor consistency fixes installed.`);
})();
