// byanca
(() => {
  'use strict';

  if (window.__ephEntityMeshCompatV15) return;
  window.__ephEntityMeshCompatV15 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const MESH_ENTITY_CLASSES = new Set([
    'func_door', 'func_door_rotating', 'func_movelinear', 'func_rotating', 'func_button',
    'func_breakable', 'func_brush', 'func_water', 'func_ladder', 'func_bomb_target',
    'func_buyzone', 'func_hostage_rescue', 'func_nav_markup', 'func_nav_blocker',
    'func_nav_avoid', 'func_nav_prefer', 'trigger_multiple', 'trigger_once', 'trigger_hurt',
    'trigger_push', 'trigger_teleport', 'trigger_gravity', 'trigger_look'
  ]);

  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const elementId = element => String(field(element, 'id')?.value || '');
  const entityProps = element => {
    const value = field(element, 'entity_properties')?.value;
    return value?.kind === 'element' ? value : null;
  };

  if (Array.isArray(ENTITIES) && !ENTITIES.some(item => item.className === 'prop_door_rotating')) {
    ENTITIES.push({ name: 'Model Door', className: 'prop_door_rotating', kind: 'entity', source: 'CS2 / Source 2' });
    ENTITIES.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  function detachById(element, targetId) {
    if (!element?.kind) return null;
    for (const item of element.fields || []) {
      if (!Array.isArray(item.value)) continue;
      const index = item.value.findIndex(child => child?.kind && elementId(child) === targetId);
      if (index >= 0) return item.value.splice(index, 1)[0];
      for (const child of item.value) {
        const found = detachById(child, targetId);
        if (found) return found;
      }
    }
    return null;
  }

  function childArray(element) {
    let children = field(element, 'children');
    if (!children) {
      children = { key: 'children', type: 'element_array', value: [] };
      element.fields.push(children);
    }
    if (!Array.isArray(children.value)) children.value = [];
    return children.value;
  }

  function allElements(doc, callback) {
    const walk = element => {
      if (!element?.kind) return;
      callback(element);
      for (const item of element.fields || []) {
        if (Array.isArray(item.value)) item.value.forEach(child => child?.kind && walk(child));
        else if (item.value?.kind) walk(item.value);
      }
    };
    for (const element of doc?.elements || []) walk(element);
  }

  function restoreMeshEntityHierarchy(doc, objects) {
    if (!doc || !Array.isArray(objects)) return objects;
    const byDmx = new Map(objects.filter(object => object?.dmxId).map(object => [String(object.dmxId), object]));
    allElements(doc, element => {
      if (element.className !== 'CMapEntity') return;
      const props = entityProps(element);
      const className = String(field(props, 'classname')?.value || '');
      if (!MESH_ENTITY_CLASSES.has(className)) return;
      const entity = byDmx.get(elementId(element));
      if (!entity) return;
      entity.ephMeshEntity = true;
      entity.ephMeshChildIds = [];
      for (const child of childArray(element)) {
        if (child?.className !== 'CMapMesh') continue;
        const mesh = byDmx.get(elementId(child));
        if (!mesh) continue;
        mesh.parent = entity.id;
        mesh.ephMeshEntityChild = true;
        entity.ephMeshChildIds.push(mesh.id);
      }
    });
    return objects;
  }

  if (!VMAP.extractObjects.__ephMeshEntityHierarchyV15) {
    const rawExtract = VMAP.extractObjects.bind(VMAP);
    VMAP.extractObjects = function(doc) {
      return restoreMeshEntityHierarchy(doc, rawExtract(doc));
    };
    VMAP.extractObjects.__ephMeshEntityHierarchyV15 = true;
    if (S.doc && Array.isArray(S.objects)) restoreMeshEntityHierarchy(S.doc, S.objects);
  }

  // Keep the in-memory scalar KeyValue object and the actual EditGameClassProps
  // in lockstep. The base writer updates/adds fields but intentionally never
  // deletes unknown Hammer data; only scalar keys that were originally exposed
  // in entityProperties are eligible for removal here.
  if (!VMAP.applyObjectToDocument.__ephEntityPropertyDeletionV15) {
    const rawApply = VMAP.applyObjectToDocument.bind(VMAP);
    VMAP.applyObjectToDocument = function(doc, object) {
      if (object?.dmxId && ['entity', 'prop'].includes(object.type) && object.entityProperties) {
        const element = VMAP.findElementByDmxId?.(doc, object.dmxId);
        const props = entityProps(element);
        if (props?.fields) {
          const keep = new Set(Object.keys(object.entityProperties));
          props.fields = props.fields.filter(item => {
            if (['id', 'classname', 'targetname', 'model'].includes(item.key)) return true;
            if (Array.isArray(item.value) || item.value?.kind) return true;
            return keep.has(item.key);
          });
        }
      }
      return rawApply(doc, object);
    };
    VMAP.applyObjectToDocument.__ephEntityPropertyDeletionV15 = true;
  }

  function convertSelectedPart(item) {
    const part = current?.();
    const className = String(item?.className || '');
    if (!part || part.type !== 'part' || !part.dmxId) {
      toast?.(`${item?.name || className}: select a Part first. Mesh/volume entities need geometry.`);
      return null;
    }

    const meshElement = VMAP.findElementByDmxId?.(S.doc, part.dmxId);
    if (!meshElement || meshElement.className !== 'CMapMesh') {
      toast?.('The selected Part could not be converted to a mesh entity.');
      return null;
    }

    pushHistory?.();
    const wrapper = ensureObject(VMAP.addEntity(S.doc, {
      className,
      name: `${className}_${String(S.objects.filter(object => object?.className === className).length + 1).padStart(2, '0')}`,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      entityProperties: {},
    }));
    const wrapperElement = VMAP.findElementByDmxId?.(S.doc, wrapper?.dmxId);
    if (!wrapper || !wrapperElement) {
      toast?.('Could not create the Hammer mesh-entity wrapper.');
      return null;
    }

    const detached = detachById({ kind: 'root', fields: [{ key: 'elements', value: S.doc.elements }] }, String(part.dmxId));
    if (!detached) {
      VMAP.removeObject?.(S.doc, wrapper);
      toast?.('Could not move the selected Part into the mesh entity.');
      return null;
    }

    childArray(wrapperElement).push(detached);
    wrapper.ephMeshEntity = true;
    wrapper.ephMeshChildIds = [part.id];
    part.parent = wrapper.id;
    part.ephMeshEntityChild = true;
    S.objects.push(wrapper);
    S.selectedId = wrapper.id;
    S.selectedFaces = new Set([0]);
    S.subSelection = null;
    S.viewport?.setObjects?.(S.objects, S.selectedId);
    markDirty?.(`Converted ${part.name} to ${className}`);
    renderTree?.();
    renderProperties?.();
    toast?.(`${part.name} is now ${className}. Edit the child mesh for geometry and the parent for entity KeyValues.`);
    return wrapper;
  }

  if (typeof addEntity === 'function' && !addEntity.__ephMeshEntityCreateV15) {
    const rawAddEntity = addEntity;
    addEntity = function(item = {}) {
      if (MESH_ENTITY_CLASSES.has(String(item.className || ''))) return convertSelectedPart(item);
      return rawAddEntity(item);
    };
    addEntity.__ephMeshEntityCreateV15 = true;
    window.addEntity = addEntity;
  }

  function installViewportMarkerGuard() {
    const viewport = S.viewport || window.EPH3D;
    const THREE = window.THREE;
    if (!viewport?.createEntityMarker || !THREE || viewport.__ephMeshEntityMarkerV15) return;
    viewport.__ephMeshEntityMarkerV15 = true;
    const rawMarker = viewport.createEntityMarker.bind(viewport);
    viewport.createEntityMarker = function(object) {
      if (object?.ephMeshEntity) {
        const group = new THREE.Group();
        group.userData.ephMeshEntityWrapper = true;
        return group;
      }
      return rawMarker(object);
    };
  }

  function installPropertyGuard() {
    if (typeof renderProperties !== 'function' || renderProperties.__ephMeshEntityGuardV15) return;
    const rawRender = renderProperties;
    renderProperties = function(...args) {
      const result = rawRender(...args);
      const object = current?.();
      if (!object?.ephMeshEntity) return result;
      const host = document.getElementById('propertiesContent');
      if (!host) return result;
      host.querySelectorAll('.prop-value[data-key="position"], .prop-value[data-key="rotation"], .prop-value[data-key="scale"]').forEach(input => {
        input.disabled = true;
        input.title = 'Edit the child mesh transform/geometry. Mesh-entity wrapper transforms are kept unchanged by EasyPeasyHammer.';
      });
      const entitySection = host.querySelector('.eph-entity-compat-section');
      if (entitySection && !entitySection.querySelector('.eph-mesh-entity-note')) {
        const note = document.createElement('div');
        note.className = 'selection-info eph-mesh-entity-note';
        note.textContent = 'Mesh entity: edit the nested Part for its shape/materials. This parent stores gameplay KeyValues and Hammer I/O.';
        entitySection.insertBefore(note, entitySection.firstChild?.nextSibling || null);
      }
      return result;
    };
    renderProperties.__ephMeshEntityGuardV15 = true;
    window.renderProperties = renderProperties;
  }

  installViewportMarkerGuard();
  installPropertyGuard();
  window.addEventListener('eph3d-ready', installViewportMarkerGuard, { once: true });
  if (S.assetTab === 'entities') queueAssetSearch?.(true);
  if (S.project) {
    renderTree?.();
    renderProperties?.();
  }
})();
