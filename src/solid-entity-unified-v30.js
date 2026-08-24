// byanca
(() => {
  'use strict';
  if (window.__ephSolidEntityUnifiedV30) return;
  window.__ephSolidEntityUnifiedV30 = true;

  const VMAP = window.EPH_VMAP;
  const api = window.easyPeasyHammer;
  const TRIGGER_MATERIAL = 'materials/tools/toolstrigger.vmat';
  const TRIGGER_CLASSES = new Set(['func_bomb_target', 'func_buyzone', 'func_hostage_rescue']);
  let viewport = null;
  let solidSelectionHelper = null;
  let wrappedRenderTree = null;
  let wrappedLoadProject = null;
  let wrappedAddEntity = null;
  let wrappedPrepare = null;

  const classKey = value => String(value || '').trim().toLowerCase();
  const objectById = id => (S?.objects || []).find(object => object?.id === id) || null;
  const isTriggerClass = className => classKey(className).startsWith('trigger_') || TRIGGER_CLASSES.has(classKey(className));
  const isMeshEntity = object => Boolean(object && ['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length));

  function report(level, message, data = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Solid Entity V30] ${message}`, data || '');
    try { api?.appLog?.(level, 'solid-entity-v30', message, data)?.catch?.(() => {}); } catch {}
  }

  function childParts(wrapper, objects = S?.objects || []) {
    if (!wrapper) return [];
    const ids = new Set(wrapper.ephMeshChildIds || []);
    for (const object of objects || []) {
      if (object?.type === 'part' && object.parent === wrapper.id) ids.add(object.id);
    }
    return [...ids].map(id => (objects || []).find(object => object?.id === id)).filter(object => object?.type === 'part');
  }

  function canonicalId(id) {
    const object = objectById(id);
    if (object?.ephMeshEntityChild && object.parent) {
      const parent = objectById(object.parent);
      if (isMeshEntity(parent)) return parent.id;
    }
    return id;
  }

  function ensureCanonicalGameplayProperties(wrapper) {
    if (!wrapper?.entityProperties) wrapper.entityProperties = {};
    let changed = false;
    if (classKey(wrapper.className) === 'func_buyzone') {
      const oldKey = Object.keys(wrapper.entityProperties).find(key => classKey(key) === 'teamnum');
      let value = oldKey ? wrapper.entityProperties[oldKey] : '0';
      const team = Number.parseInt(String(value ?? '0'), 10);
      value = [0, 2, 3].includes(team) ? String(team) : '0';
      if (oldKey && oldKey !== 'TeamNum') { delete wrapper.entityProperties[oldKey]; changed = true; }
      if (String(wrapper.entityProperties.TeamNum ?? '') !== value) { wrapper.entityProperties.TeamNum = value; changed = true; }
    }
    if (classKey(wrapper.className) === 'func_bomb_target') {
      const ensure = (key, value) => {
        if (!Object.prototype.hasOwnProperty.call(wrapper.entityProperties, key)) {
          wrapper.entityProperties[key] = value;
          changed = true;
        }
      };
      ensure('heistbomb', '0');
      ensure('bomb_mount_target', '');
      ensure('bomb_site_designation', '0');
      const designation = Number.parseInt(String(wrapper.entityProperties.bomb_site_designation ?? '0'), 10);
      const normalized = designation === 1 ? '1' : '0';
      if (String(wrapper.entityProperties.bomb_site_designation) !== normalized) {
        wrapper.entityProperties.bomb_site_designation = normalized;
        changed = true;
      }
    }
    return changed;
  }

  function configureTriggerPart(part, doc = S?.doc, updateViewport = true) {
    if (!part?.dmxId) return false;
    let changed = false;
    const faceCount = Math.max(1, part.faces?.length || part.faceMaterials?.length || 6);
    const wanted = Array.from({ length: faceCount }, () => TRIGGER_MATERIAL);
    if (!Array.isArray(part.faceMaterials) || part.faceMaterials.length !== faceCount || part.faceMaterials.some(value => String(value) !== TRIGGER_MATERIAL)) {
      part.faceMaterials = wanted;
      changed = true;
    }
    part.materials ||= {};
    for (const key of ['right', 'left', 'front', 'back', 'top', 'bottom']) {
      if (part.materials[key] !== TRIGGER_MATERIAL) { part.materials[key] = TRIGGER_MATERIAL; changed = true; }
    }

    // toolstrigger.vmat is already mapbuilder.nonsolid. Keep the CMapMesh physics
    // model at Hammer's normal "default" so the mesh entity still owns a touch
    // volume. V25 used collision=false -> physicsType=none, which could erase the
    // trigger shape entirely at compile time.
    if (part.collision !== true) { part.collision = true; changed = true; }
    for (const key of ['blockPlayers', 'blockGrenades', 'blockBullets']) {
      if (part[key] !== false) { part[key] = false; changed = true; }
    }
    if (!part.ephTriggerVolume) { part.ephTriggerVolume = true; changed = true; }
    if (changed && doc) VMAP.applyObjectToDocument?.(doc, part);
    if (changed && updateViewport) S?.viewport?.updateObject?.(part);
    return changed;
  }

  function repairWrapper(wrapper, doc = S?.doc, objects = S?.objects || [], updateViewport = true) {
    if (!isMeshEntity(wrapper) || !isTriggerClass(wrapper.className)) return false;
    let changed = ensureCanonicalGameplayProperties(wrapper);
    const parts = childParts(wrapper, objects);
    const ids = [];
    for (const part of parts) {
      ids.push(part.id);
      if (part.parent !== wrapper.id) { part.parent = wrapper.id; changed = true; }
      if (!part.ephMeshEntityChild) { part.ephMeshEntityChild = true; changed = true; }
      if (configureTriggerPart(part, doc, updateViewport)) changed = true;
    }
    if (!wrapper.ephMeshEntity) { wrapper.ephMeshEntity = true; changed = true; }
    const beforeIds = JSON.stringify(wrapper.ephMeshChildIds || []);
    const afterIds = JSON.stringify(ids);
    if (beforeIds !== afterIds) { wrapper.ephMeshChildIds = ids; changed = true; }
    if (changed && wrapper?.dmxId && doc) VMAP.applyObjectToDocument?.(doc, wrapper);
    return changed;
  }

  function repairAll(doc = S?.doc, objects = S?.objects || [], options = {}) {
    if (!doc || !Array.isArray(objects)) return 0;
    let changed = 0;
    for (const wrapper of objects) if (repairWrapper(wrapper, doc, objects, options.updateViewport !== false)) changed++;
    if (changed && options.markDirty) {
      try { markDirty?.(`Repaired ${changed} CS2 gameplay volume${changed === 1 ? '' : 's'}`); } catch {}
    }
    if (changed) report('normal', `Repaired ${changed} CS2 mesh gameplay volume${changed === 1 ? '' : 's'}.`, { physicsType: 'default', material: TRIGGER_MATERIAL });
    return changed;
  }

  function installPrepareForSave() {
    if (!VMAP?.prepareForSave) return false;
    if (VMAP.prepareForSave.__ephSolidEntityUnifiedV30) { wrappedPrepare = VMAP.prepareForSave; return true; }
    const raw = VMAP.prepareForSave.bind(VMAP);
    const wrapped = function(doc, objects) {
      repairAll(doc, objects, { updateViewport: false, markDirty: false });
      return raw(doc, objects);
    };
    wrapped.__ephSolidEntityUnifiedV30 = true;
    wrapped.__ephPrevious = raw;
    VMAP.prepareForSave = wrapped;
    wrappedPrepare = wrapped;
    return true;
  }

  function installAddEntity() {
    if (typeof addEntity !== 'function') return false;
    if (addEntity.__ephSolidEntityUnifiedV30) { wrappedAddEntity = addEntity; return true; }
    const raw = addEntity;
    const wrapped = function(item = {}) {
      const result = raw(item);
      const wanted = classKey(item?.className);
      if (isTriggerClass(wanted)) {
        const wrapper = (result && isMeshEntity(result) ? result : null)
          || (isMeshEntity(current?.()) && classKey(current()?.className) === wanted ? current() : null);
        if (wrapper && repairWrapper(wrapper, S.doc, S.objects, true)) {
          try { markDirty?.(`Configured ${wrapper.className} gameplay volume`); } catch {}
          renderTree?.();
          renderProperties?.();
        }
      }
      return result;
    };
    for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
    wrapped.__ephSolidEntityUnifiedV30 = true;
    wrapped.__ephPrevious = raw;
    addEntity = wrapped;
    window.addEntity = wrapped;
    wrappedAddEntity = wrapped;
    return true;
  }

  function visibleTreeOrder() {
    const objects = S?.objects || [];
    const query = String(document.getElementById('sceneSearch')?.value || '').trim().toLowerCase();
    const byParent = new Map();
    for (const object of objects) {
      const key = object.parent == null ? null : object.parent;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(object);
    }
    const output = [];
    const walk = object => {
      const kids = byParent.get(object.id) || [];
      if (query && !String(object.name || '').toLowerCase().includes(query) && !kids.some(child => String(child.name || '').toLowerCase().includes(query))) return;
      output.push(object);
      if (object.expanded) for (const child of kids) walk(child);
    };
    for (const object of byParent.get(null) || []) walk(object);
    return output;
  }

  function cleanTree() {
    const tree = document.getElementById('sceneTree');
    if (!tree) return;
    const rows = [...tree.querySelectorAll('.tree-row')];
    const order = visibleTreeOrder();
    rows.forEach((row, index) => {
      const id = row.dataset.objectId || order[index]?.id || '';
      const object = objectById(id);
      row.hidden = Boolean(object?.ephMeshEntityChild);
      if (isMeshEntity(object)) {
        const chevron = row.querySelector('.tree-chevron');
        if (chevron) chevron.style.visibility = childParts(object).length ? 'hidden' : '';
      }
    });
  }

  function installTree() {
    if (typeof renderTree !== 'function') return false;
    if (!renderTree.__ephSolidEntityUnifiedV30) {
      const raw = renderTree;
      const wrapped = function(...args) {
        const result = raw(...args);
        queueMicrotask(cleanTree);
        return result;
      };
      for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
      wrapped.__ephSolidEntityUnifiedV30 = true;
      wrapped.__ephPrevious = raw;
      renderTree = wrapped;
      window.renderTree = wrapped;
      wrappedRenderTree = wrapped;
    } else wrappedRenderTree = renderTree;
    queueMicrotask(cleanTree);
    return true;
  }

  function ensureSelectionHelper(vp) {
    const THREE = window.EPH_THREE || window.THREE;
    if (!THREE?.Box3Helper || !vp?.scene) return null;
    if (solidSelectionHelper && solidSelectionHelper.parent === vp.scene) return solidSelectionHelper;
    const box = new THREE.Box3();
    solidSelectionHelper = new THREE.Box3Helper(box, 0x3d9cff);
    solidSelectionHelper.visible = false;
    solidSelectionHelper.material.depthTest = false;
    solidSelectionHelper.material.transparent = true;
    solidSelectionHelper.material.opacity = 0.95;
    solidSelectionHelper.renderOrder = 1001;
    solidSelectionHelper.userData.ephSolidEntitySelection = true;
    vp.scene.add(solidSelectionHelper);
    return solidSelectionHelper;
  }

  function updateSolidSelection(vp = viewport) {
    if (!vp) return false;
    const wrapper = objectById(canonicalId(vp.selectedId || S?.selectedId));
    const helper = ensureSelectionHelper(vp);
    if (!helper || !isMeshEntity(wrapper)) {
      if (helper) helper.visible = false;
      return false;
    }
    const roots = childParts(wrapper).map(part => vp.objectRoots?.get?.(part.id)).filter(Boolean);
    if (!roots.length) { helper.visible = false; return false; }
    helper.box.makeEmpty();
    for (const root of roots) {
      root.updateWorldMatrix?.(true, true);
      helper.box.expandByObject(root);
    }
    helper.visible = !helper.box.isEmpty();
    if (vp.selectionBox) vp.selectionBox.visible = false;

    // Mesh Entity Transform V31 deliberately attaches TransformControls to the
    // entity's owned Part while keeping the entity wrapper logically selected.
    // The old selection-helper code detached TransformControls every time the
    // box refreshed. objectChange -> updateSelectionBox therefore detached the
    // gizmo in the middle of move/rotate/scale drags, which made every brush
    // entity (buyzones, bombsites, triggers, etc.) feel jumpy or stop responding.
    // Never detach an active/owned child transform. Only clear a stale generic
    // wrapper gizmo when no entity transform is in progress.
    const transformTool = ['move', 'rotate', 'scale'].includes(String(vp.tool || ''));
    const ownsActiveTransform = transformTool && roots.includes(vp.transform?.object);
    if (!vp.transform?.dragging && !ownsActiveTransform) vp.transform?.detach?.();
    return helper.visible;
  }

  function installViewport() {
    const vp = S?.viewport || window.EPH3D;
    if (!vp?.select || !vp?.renderer?.domElement) return false;
    viewport = vp;
    ensureSelectionHelper(vp);
    if (!vp.select.__ephSolidEntityUnifiedV30) {
      const rawSelect = vp.select.bind(vp);
      const wrappedSelect = function(id, notify = true) {
        const wanted = canonicalId(id);
        const result = rawSelect(wanted, notify);
        queueMicrotask(() => updateSolidSelection(this));
        return result;
      };
      wrappedSelect.__ephSolidEntityUnifiedV30 = true;
      wrappedSelect.__ephPrevious = rawSelect;
      vp.select = wrappedSelect;
    }
    if (vp.updateSelectionBox && !vp.updateSelectionBox.__ephSolidEntityUnifiedV30) {
      const rawUpdate = vp.updateSelectionBox.bind(vp);
      const wrappedUpdate = function(...args) {
        if (updateSolidSelection(this)) return;
        return rawUpdate(...args);
      };
      wrappedUpdate.__ephSolidEntityUnifiedV30 = true;
      wrappedUpdate.__ephPrevious = rawUpdate;
      vp.updateSelectionBox = wrappedUpdate;
    }
    if (vp.setObjects && !vp.setObjects.__ephSolidEntityUnifiedV30) {
      const rawSet = vp.setObjects.bind(vp);
      const wrappedSet = function(...args) {
        const result = rawSet(...args);
        queueMicrotask(() => updateSolidSelection(this));
        return result;
      };
      wrappedSet.__ephSolidEntityUnifiedV30 = true;
      wrappedSet.__ephPrevious = rawSet;
      vp.setObjects = wrappedSet;
    }
    if (vp.updateObject && !vp.updateObject.__ephSolidEntityUnifiedV30) {
      const rawObject = vp.updateObject.bind(vp);
      const wrappedObject = function(...args) {
        const result = rawObject(...args);
        queueMicrotask(() => updateSolidSelection(this));
        return result;
      };
      wrappedObject.__ephSolidEntityUnifiedV30 = true;
      wrappedObject.__ephPrevious = rawObject;
      vp.updateObject = wrappedObject;
    }
    queueMicrotask(() => updateSolidSelection(vp));
    return true;
  }

  function hitSolidChild(event) {
    const vp = viewport || S?.viewport || window.EPH3D;
    if (!vp?.renderer?.domElement || event.target !== vp.renderer.domElement) return null;
    const rect = vp.renderer.domElement.getBoundingClientRect();
    vp.pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    vp.pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    vp.raycaster.setFromCamera(vp.pointer, vp.camera);
    const hits = vp.raycaster.intersectObjects([...vp.objectRoots.values()], true);
    for (const hit of hits) {
      let root = hit.object;
      while (root.parent && root.parent !== vp.objectGroup) root = root.parent;
      const object = objectById(root.userData?.ephId);
      if (!object?.ephMeshEntityChild || !object.parent) continue;
      const wrapper = objectById(object.parent);
      if (isMeshEntity(wrapper)) return wrapper;
    }
    return null;
  }

  function installMultiSelectBridge() {
    if (window.__ephSolidEntityV30MultiBridge) return;
    window.__ephSolidEntityV30MultiBridge = true;
    window.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey || event.shiftKey)) return;
      const wrapper = hitSolidChild(event);
      if (!wrapper || !window.EPH_MULTI_SELECTION?.toggle) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.EPH_MULTI_SELECTION.toggle(wrapper.id);
    }, true);
  }

  function installLoadProject() {
    if (typeof window.loadProject !== 'function') return false;
    if (window.loadProject.__ephSolidEntityUnifiedV30) { wrappedLoadProject = window.loadProject; return true; }
    const raw = window.loadProject;
    const wrapped = async function(...args) {
      const result = await raw(...args);
      if (result) {
        installViewport();
        const changed = repairAll(S?.doc, S?.objects || [], { updateViewport: true, markDirty: false });
        if (changed) {
          S.dirty = true;
          try { updateTitle?.(); } catch {}
          try { renderTree?.(); renderProperties?.(); } catch {}
        }
        queueMicrotask(cleanTree);
      }
      return result;
    };
    for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
    wrapped.__ephSolidEntityUnifiedV30 = true;
    wrapped.__ephPrevious = raw;
    window.loadProject = wrapped;
    try { loadProject = wrapped; } catch {}
    wrappedLoadProject = wrapped;
    return true;
  }

  function install() {
    if (!VMAP || typeof S === 'undefined') return false;
    installPrepareForSave();
    installAddEntity();
    installTree();
    installViewport();
    installMultiSelectBridge();
    installLoadProject();
    if (S?.project && S?.doc) repairAll(S.doc, S.objects || [], { updateViewport: true, markDirty: false });
    return true;
  }

  install();
  [300, 900, 1800, 3500, 6500].forEach(delay => setTimeout(() => {
    installViewport();
    if (wrappedRenderTree && renderTree !== wrappedRenderTree) installTree();
    if (wrappedLoadProject && window.loadProject !== wrappedLoadProject) installLoadProject();
    if (wrappedAddEntity && addEntity !== wrappedAddEntity) installAddEntity();
    if (wrappedPrepare && VMAP.prepareForSave !== wrappedPrepare) installPrepareForSave();
    cleanTree();
  }, delay));
  window.addEventListener('eph3d-ready', installViewport, { once: true });

  window.EPH_SOLID_ENTITY_V30 = {
    repair: () => repairAll(S?.doc, S?.objects || [], { updateViewport: true, markDirty: true }),
    canonicalId,
    childParts,
  };

  report('normal', 'Unified CS2 mesh-entity runtime installed. Trigger physics, tree ownership and 3D selection are repaired.');
})();
