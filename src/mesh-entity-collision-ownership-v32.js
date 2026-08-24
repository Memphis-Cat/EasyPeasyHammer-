// byanca
(() => {
  'use strict';
  if (window.__ephMeshEntityCollisionOwnershipV32) return;
  window.__ephMeshEntityCollisionOwnershipV32 = true;

  const VMAP = window.EPH_VMAP;
  const api = window.easyPeasyHammer;
  if (!VMAP) return;

  const PREFIX = VMAP.HELPER_PREFIX || 'EPH_HELPER_';
  const MATERIALS = {
    players: 'materials/tools/toolsplayerclip.vmat',
    grenades: 'materials/tools/toolsgrenadeclip.vmat',
    bullets: 'materials/tools/toolsblockbullets_cs.vmat',
  };
  const NON_BLOCKING_VOLUMES = new Set(['func_bomb_target', 'func_buyzone', 'func_hostage_rescue', 'func_precipitation']);

  let syncing = false;
  let rawApply = null;
  let installedPrepare = null;
  let wrappedAddEntity = null;
  let wrappedRenderProperties = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const objects = () => state()?.objects || [];
  const classKey = value => String(value || '').trim().toLowerCase();
  const isMeshEntity = object => Boolean(object && ['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length));
  const isWeatherVolume = object => Boolean(object?.ephWeatherVolume);
  const isNonBlockingVolume = object => Boolean(object && (classKey(object.className).startsWith('trigger_') || NON_BLOCKING_VOLUMES.has(classKey(object.className))));

  function report(level, message, data = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Mesh Entity Collision V32] ${message}`, data || '');
    try { api?.appLog?.(level, 'mesh-entity-collision-v32', message, data)?.catch?.(() => {}); } catch {}
  }

  function childParts(wrapper, list = objects()) {
    if (!wrapper) return [];
    const ids = new Set(wrapper.ephMeshChildIds || []);
    for (const object of list || []) if (object?.type === 'part' && object.parent === wrapper.id) ids.add(object.id);
    return [...ids].map(id => (list || []).find(object => object?.id === id)).filter(object => object?.type === 'part');
  }

  function setFlag(object, key, value) {
    if (!object || object[key] === value) return false;
    object[key] = value;
    return true;
  }

  function writeObject(doc, object) {
    if (!doc || !object?.dmxId || !rawApply) return;
    try { rawApply(doc, object); }
    catch (error) { report('warning', `Could not write collision state for ${object.name || object.id}.`, error?.message || String(error)); }
  }

  function syncWrapper(wrapper, options = {}) {
    if (!isMeshEntity(wrapper)) return false;
    const doc = options.doc || state()?.doc;
    const list = options.objects || objects();
    const volume = isNonBlockingVolume(wrapper);
    let changed = false;

    wrapper.ephCollisionOwnedByEntity = true;
    if (volume) {
      changed = setFlag(wrapper, 'blockPlayers', false) || changed;
      changed = setFlag(wrapper, 'blockGrenades', false) || changed;
      changed = setFlag(wrapper, 'blockBullets', false) || changed;
    }

    for (const part of childParts(wrapper, list)) {
      part.ephMeshEntityChild = true;
      part.ephCollisionOwnerId = wrapper.id;
      changed = setFlag(part, 'blockPlayers', false) || changed;
      changed = setFlag(part, 'blockGrenades', false) || changed;
      changed = setFlag(part, 'blockBullets', false) || changed;
      changed = setFlag(part, 'collision', volume ? true : wrapper.collision !== false) || changed;
      writeObject(doc, part);
      if (options.updateViewport) state()?.viewport?.updateObject?.(part);
    }

    if (options.writeWrapper) writeObject(doc, wrapper);
    return changed;
  }

  function adoptNewWrapper(wrapper) {
    if (!isMeshEntity(wrapper)) return false;
    const children = childParts(wrapper);
    let changed = false;

    if (isNonBlockingVolume(wrapper)) {
      changed = setFlag(wrapper, 'collision', true) || changed;
      changed = setFlag(wrapper, 'blockPlayers', false) || changed;
      changed = setFlag(wrapper, 'blockGrenades', false) || changed;
      changed = setFlag(wrapper, 'blockBullets', false) || changed;
    } else if (children.length) {
      const source = children[0];
      changed = setFlag(wrapper, 'collision', source.collision !== false) || changed;
      changed = setFlag(wrapper, 'blockPlayers', Boolean(source.blockPlayers)) || changed;
      changed = setFlag(wrapper, 'blockGrenades', Boolean(source.blockGrenades)) || changed;
      changed = setFlag(wrapper, 'blockBullets', Boolean(source.blockBullets)) || changed;
    }

    wrapper.ephCollisionOwnedByEntity = true;
    changed = syncWrapper(wrapper, { doc: state()?.doc, updateViewport: true, writeWrapper: true }) || changed;
    return changed;
  }

  function neutralizeWeather(object, options = {}) {
    if (!isWeatherVolume(object)) return false;
    let changed = false;
    changed = setFlag(object, 'blockPlayers', false) || changed;
    changed = setFlag(object, 'blockGrenades', false) || changed;
    changed = setFlag(object, 'blockBullets', false) || changed;
    changed = setFlag(object, 'collision', true) || changed;
    if (changed) writeObject(options.doc || state()?.doc, object);
    return changed;
  }

  function syncAll(list = objects(), options = {}) {
    let changed = 0;
    for (const object of list || []) {
      if (isMeshEntity(object) && syncWrapper(object, { ...options, objects: list })) changed++;
      else if (isWeatherVolume(object) && neutralizeWeather(object, options)) changed++;
    }
    return changed;
  }

  function sourceGeometry(object) {
    const vertices = Array.isArray(object?.vertices) && object.vertices.length
      ? object.vertices.map(vertex => Array.isArray(vertex) ? [...vertex] : vertex)
      : null;
    const faces = Array.isArray(object?.faces) && object.faces.length
      ? object.faces.map(face => Array.isArray(face) ? [...face] : face)
      : null;
    return vertices && faces ? { vertices, faces } : null;
  }

  function addOwnedHelper(doc, wrapper, part, type, material) {
    const geometry = sourceGeometry(part);
    const faceCount = geometry?.faces?.length || 6;
    const options = {
      size: Array.isArray(part?.size) ? [...part.size] : [64, 64, 64],
      position: Array.isArray(part?.position) ? [...part.position] : [0, 0, 0],
      rotation: Array.isArray(part?.rotation) ? [...part.rotation] : [0, 0, 0],
      scale: Array.isArray(part?.scale) ? [...part.scale] : [1, 1, 1],
      collision: true,
      visible: true,
      meshName: `${PREFIX}${type}_${wrapper.dmxId}_${part.dmxId}`,
      material,
      faceMaterials: Array.from({ length: faceCount }, () => material),
    };
    if (geometry) {
      options.vertices = geometry.vertices;
      options.faces = geometry.faces;
    }
    VMAP.addPart(doc, options);
  }

  function appendOwnedHelpers(doc, list) {
    const counts = { players: 0, grenades: 0, bullets: 0 };
    for (const wrapper of list || []) {
      if (!isMeshEntity(wrapper) || !wrapper?.dmxId || isNonBlockingVolume(wrapper)) continue;
      for (const part of childParts(wrapper, list)) {
        if (!part?.dmxId) continue;
        if (wrapper.blockPlayers) { addOwnedHelper(doc, wrapper, part, 'players', MATERIALS.players); counts.players++; }
        if (wrapper.blockGrenades) { addOwnedHelper(doc, wrapper, part, 'grenades', MATERIALS.grenades); counts.grenades++; }
        if (wrapper.blockBullets) { addOwnedHelper(doc, wrapper, part, 'bullets', MATERIALS.bullets); counts.bullets++; }
      }
    }
    if (counts.players || counts.grenades || counts.bullets) report('normal', 'Exported entity-owned collision helpers.', counts);
    return doc;
  }

  function installApply() {
    if (VMAP.applyObjectToDocument?.__ephMeshEntityCollisionV32) {
      rawApply = VMAP.applyObjectToDocument.__ephRawApplyV32 || rawApply;
      return true;
    }
    const previous = VMAP.applyObjectToDocument.bind(VMAP);
    rawApply = previous;
    const wrapped = function(doc, object, ...rest) {
      const result = previous(doc, object, ...rest);
      if (syncing || !object) return result;
      try {
        syncing = true;
        if (isMeshEntity(object)) syncWrapper(object, { doc, updateViewport: false });
        else if (isWeatherVolume(object)) neutralizeWeather(object, { doc });
      } finally { syncing = false; }
      return result;
    };
    wrapped.__ephMeshEntityCollisionV32 = true;
    wrapped.__ephRawApplyV32 = previous;
    wrapped.__ephPrevious = previous;
    VMAP.applyObjectToDocument = wrapped;
    return true;
  }

  function installPrepare() {
    if (VMAP.prepareForSave?.__ephMeshEntityCollisionV32) {
      installedPrepare = VMAP.prepareForSave;
      return true;
    }
    const previous = VMAP.prepareForSave.bind(VMAP);
    const wrapped = function(doc, list, ...rest) {
      syncAll(list, { doc, updateViewport: false });

      const propSnapshots = [];
      for (const object of list || []) {
        if (!isMeshEntity(object) || object.type !== 'prop') continue;
        propSnapshots.push([object, object.blockPlayers, object.blockGrenades, object.blockBullets]);
        object.blockPlayers = false;
        object.blockGrenades = false;
        object.blockBullets = false;
      }

      let prepared;
      try { prepared = previous(doc, list, ...rest); }
      finally {
        for (const [object, players, grenades, bullets] of propSnapshots) {
          object.blockPlayers = players;
          object.blockGrenades = grenades;
          object.blockBullets = bullets;
        }
      }
      return appendOwnedHelpers(prepared, list);
    };
    wrapped.__ephMeshEntityCollisionV32 = true;
    wrapped.__ephPrevious = previous;
    VMAP.prepareForSave = wrapped;
    installedPrepare = wrapped;
    return true;
  }

  function installAddEntity() {
    if (typeof addEntity !== 'function') return false;
    if (addEntity.__ephMeshEntityCollisionV32) {
      wrappedAddEntity = addEntity;
      return true;
    }
    const previous = addEntity;
    const wrapped = function(item = {}, ...rest) {
      const before = new Set(objects().map(object => object?.id));
      const result = previous(item, ...rest);
      const created = result && isMeshEntity(result)
        ? result
        : objects().find(object => !before.has(object?.id) && isMeshEntity(object))
          || (isMeshEntity(current?.()) ? current() : null);
      if (created) {
        adoptNewWrapper(created);
        try { renderProperties?.(); renderTree?.(); } catch {}
        report('normal', `${created.className || 'Mesh entity'} now owns collision settings.`, {
          wrapper: created.name || created.id,
          children: childParts(created).map(part => part.id),
        });
      }
      return result;
    };
    for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
    wrapped.__ephMeshEntityCollisionV32 = true;
    wrapped.__ephPrevious = previous;
    addEntity = wrapped;
    window.addEntity = wrapped;
    wrappedAddEntity = wrapped;
    return true;
  }

  function collisionSection(host) {
    const title = [...(host?.querySelectorAll?.('.property-section-title') || [])]
      .find(element => String(element.textContent || '').trim() === 'Collision / Gameplay');
    return title?.closest?.('.property-section') || null;
  }

  function hideBlockerRows(section) {
    for (const key of ['blockPlayers', 'blockGrenades', 'blockBullets']) {
      const row = section?.querySelector?.(`[data-toggle="${key}"]`)?.closest?.('.toggle-row');
      if (row) row.style.display = 'none';
    }
  }

  function decorateProperties() {
    const object = current?.();
    const host = document.getElementById('propertiesContent');
    if (!object || !host) return;
    const section = collisionSection(host);

    if (object.ephMeshEntityChild) {
      if (section) section.style.display = 'none';
      return;
    }

    if (isWeatherVolume(object)) {
      neutralizeWeather(object, { doc: state()?.doc });
      if (section) section.style.display = 'none';
      const weather = host.querySelector('.eph-weather-volume-v27');
      if (weather && !weather.querySelector('.eph-collision-owner-note-v32')) {
        const note = document.createElement('div');
        note.className = 'selection-info eph-collision-owner-note-v32';
        note.textContent = 'This precipitation volume is non-blocking. Its internal brush cannot create player, grenade or bullet clip helpers.';
        weather.appendChild(note);
      }
      return;
    }

    if (!isMeshEntity(object) || !section) return;
    if (isNonBlockingVolume(object)) hideBlockerRows(section);
    if (!section.querySelector('.eph-collision-owner-note-v32')) {
      const note = document.createElement('div');
      note.className = 'selection-info eph-collision-owner-note-v32';
      note.textContent = isNonBlockingVolume(object)
        ? 'This gameplay volume is intentionally non-blocking. Its hidden Part only supplies the entity shape and cannot export clip meshes.'
        : 'Collision belongs to this entity. Its hidden Part is geometry-only and cannot independently create player, grenade or bullet clip meshes.';
      section.appendChild(note);
    }
  }

  function installProperties() {
    if (typeof renderProperties !== 'function') return false;
    if (renderProperties.__ephMeshEntityCollisionV32) {
      wrappedRenderProperties = renderProperties;
      queueMicrotask(decorateProperties);
      return true;
    }
    const previous = renderProperties;
    const wrapped = function(...args) {
      const result = previous(...args);
      queueMicrotask(decorateProperties);
      return result;
    };
    for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
    wrapped.__ephMeshEntityCollisionV32 = true;
    wrapped.__ephPrevious = previous;
    renderProperties = wrapped;
    window.renderProperties = wrapped;
    wrappedRenderProperties = wrapped;
    queueMicrotask(decorateProperties);
    return true;
  }

  function repairCurrentProject() {
    if (!state()?.doc) return;
    const changed = syncAll(objects(), { doc: state().doc, updateViewport: true });
    if (changed) {
      try { state().dirty = true; updateTitle?.(); } catch {}
      report('warning', `Removed stale collision ownership from ${changed} hidden entity/weather mesh${changed === 1 ? '' : 'es'}. Save the map to keep the repair.`);
    }
  }

  function install() {
    if (!VMAP || typeof S === 'undefined') return false;
    installApply();
    installPrepare();
    installAddEntity();
    installProperties();
    repairCurrentProject();
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', install, { once: true });
  window.addEventListener('eph-runtime-ready', () => { install(); repairCurrentProject(); }, { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    installApply();
    if (installedPrepare && VMAP.prepareForSave !== installedPrepare) installPrepare();
    if (wrappedAddEntity && addEntity !== wrappedAddEntity) installAddEntity();
    if (wrappedRenderProperties && renderProperties !== wrappedRenderProperties) installProperties();
    if (checks >= 36) clearInterval(guard);
  }, 250);

  window.EPH_MESH_ENTITY_COLLISION_V32 = {
    sync: wrapper => syncWrapper(wrapper, { doc: state()?.doc, updateViewport: true }),
    repair: repairCurrentProject,
    childParts,
  };

  report('normal', 'Entity-owned collision installed. Hidden Parts can no longer export duplicate collision/clip helpers.');
})();
