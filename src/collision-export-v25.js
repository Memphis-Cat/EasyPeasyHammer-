// byanca
(() => {
  'use strict';
  if (window.__ephCollisionExportV25) return;
  window.__ephCollisionExportV25 = true;

  const VMAP = window.EPH_VMAP;
  const api = window.easyPeasyHammer;
  if (!VMAP) return;

  const MATERIALS = {
    players: 'materials/tools/toolsplayerclip.vmat',
    grenades: 'materials/tools/toolsgrenadeclip.vmat',
    bullets: 'materials/tools/toolsblockbullets_cs.vmat',
  };
  const PREFIX = VMAP.HELPER_PREFIX || 'EPH_HELPER_';
  const TRIGGER_CLASSES = new Set(['func_bomb_target', 'func_buyzone', 'func_hostage_rescue']);

  const classKey = value => String(value || '').trim().toLowerCase();
  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const arrayValue = (element, key) => {
    const value = field(element, key)?.value;
    return Array.isArray(value) ? value : [];
  };
  const elementValue = (element, key) => {
    const value = field(element, key)?.value;
    return value?.kind === 'element' ? value : null;
  };
  const report = (level, message, data = null) => {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Collision Export V25] ${message}`, data || '');
    try { api?.appLog?.(level, 'collision-export-v25', message, data)?.catch?.(() => {}); } catch {}
  };

  function helperName(element) {
    if (element?.className !== 'CMapMesh') return '';
    return String(field(elementValue(element, 'meshData'), 'name')?.value || '');
  }

  function removeOldHelpers(list) {
    if (!Array.isArray(list)) return 0;
    let removed = 0;
    for (let index = list.length - 1; index >= 0; index--) {
      const element = list[index];
      if (element?.className === 'CMapMesh' && helperName(element).startsWith(PREFIX)) {
        list.splice(index, 1);
        removed++;
        continue;
      }
      if (element?.kind) removed += removeOldHelpers(arrayValue(element, 'children'));
    }
    return removed;
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

  function addHelper(doc, object, type, material) {
    const geometry = sourceGeometry(object);
    const faceCount = geometry?.faces?.length || 6;
    const options = {
      size: Array.isArray(object?.size) ? [...object.size] : [64, 64, 64],
      position: Array.isArray(object?.position) ? [...object.position] : [0, 0, 0],
      rotation: Array.isArray(object?.rotation) ? [...object.rotation] : [0, 0, 0],
      scale: Array.isArray(object?.scale) ? [...object.scale] : [1, 1, 1],
      collision: true,
      visible: true,
      meshName: `${PREFIX}${type}_${object.dmxId}`,
      material,
      faceMaterials: Array.from({ length: faceCount }, () => material),
    };
    if (geometry) {
      options.vertices = geometry.vertices;
      options.faces = geometry.faces;
    }
    return VMAP.addPart(doc, options);
  }

  function exportHelpers(doc, objects) {
    const worldChildren = VMAP.getWorldChildren?.(doc) || [];
    const removed = removeOldHelpers(worldChildren);
    const counts = { players: 0, grenades: 0, bullets: 0, removed };
    for (const object of objects || []) {
      if (!object?.dmxId || !['part', 'prop'].includes(object.type)) continue;
      if (object.blockPlayers) { addHelper(doc, object, 'players', MATERIALS.players); counts.players++; }
      if (object.blockGrenades) { addHelper(doc, object, 'grenades', MATERIALS.grenades); counts.grenades++; }
      if (object.blockBullets) { addHelper(doc, object, 'bullets', MATERIALS.bullets); counts.bullets++; }
    }
    report('normal', 'Generated Hammer collision helper meshes.', counts);
    return doc;
  }

  let installedPrepare = null;
  function installSaveExport() {
    if (VMAP.prepareForSave?.__ephCollisionExportV25) {
      installedPrepare = VMAP.prepareForSave;
      VMAP.syncCollisionHelpers = exportHelpers;
      return;
    }
    const rawPrepare = VMAP.prepareForSave.bind(VMAP);
    const wrapped = function(doc, objects) {
      const prepared = rawPrepare(doc, objects);
      return exportHelpers(prepared, objects);
    };
    wrapped.__ephCollisionExportV25 = true;
    wrapped.__ephPrevious = rawPrepare;
    VMAP.prepareForSave = wrapped;
    VMAP.syncCollisionHelpers = exportHelpers;
    installedPrepare = wrapped;
    report('normal', 'Collision helper export installed. Player/Grenade/Bullet toggles now create Hammer tool meshes on every save.');
  }

  function isTriggerClass(className) {
    const name = classKey(className);
    return name.startsWith('trigger_') || TRIGGER_CLASSES.has(name);
  }

  function childParts(wrapper) {
    if (!wrapper) return [];
    const ids = new Set(wrapper.ephMeshChildIds || []);
    for (const object of S?.objects || []) if (object?.parent === wrapper.id && object.type === 'part') ids.add(object.id);
    return [...ids].map(id => S?.objects?.find(object => object.id === id)).filter(object => object?.type === 'part');
  }

  function makeTriggerPassable(wrapper) {
    if (!wrapper || !isTriggerClass(wrapper.className)) return false;
    let changed = false;
    for (const part of childParts(wrapper)) {
      if (part.collision !== false || part.blockPlayers || part.blockGrenades || part.blockBullets) {
        part.collision = false;
        part.blockPlayers = false;
        part.blockGrenades = false;
        part.blockBullets = false;
        VMAP.applyObjectToDocument?.(S.doc, part);
        S.viewport?.updateObject?.(part);
        changed = true;
      }
    }
    if (changed) {
      markDirty?.(`Configured ${wrapper.className} as passable trigger volume`);
      report('normal', `New ${wrapper.className} volume defaults to passable trigger collision.`, { wrapper: wrapper.name || wrapper.id });
    }
    return changed;
  }

  let wrappedAddEntity = null;
  function installTriggerDefaults() {
    if (typeof addEntity !== 'function' || addEntity.__ephCollisionExportV25) return;
    const rawAddEntity = addEntity;
    const wrapped = function(item = {}) {
      const before = new Set((S?.objects || []).map(object => object.id));
      const result = rawAddEntity(item);
      const wanted = classKey(item?.className);
      const wrapper = (result && isTriggerClass(result.className) ? result : null)
        || (S?.objects || []).find(object => !before.has(object.id) && classKey(object?.className) === wanted && isTriggerClass(object.className))
        || (isTriggerClass(current?.()?.className) ? current() : null);
      if (wrapper) { makeTriggerPassable(wrapper); renderProperties?.(); }
      return result;
    };
    wrapped.__ephCollisionExportV25 = true;
    wrapped.__ephPrevious = rawAddEntity;
    addEntity = wrapped;
    window.addEntity = wrapped;
    wrappedAddEntity = wrapped;
  }

  let wrappedRenderProperties = null;
  function installPropertyExplanation() {
    if (typeof renderProperties !== 'function' || renderProperties.__ephCollisionExportV25) return;
    const rawRender = renderProperties;
    const wrapped = function(...args) {
      const result = rawRender(...args);
      const host = document.getElementById('propertiesContent');
      if (!host) return result;
      const player = host.querySelector('[data-toggle="blockPlayers"]');
      const grenade = host.querySelector('[data-toggle="blockGrenades"]');
      const bullets = host.querySelector('[data-toggle="blockBullets"]');
      if (player) player.closest('.toggle-row')?.setAttribute('title', 'Exports an exact-shape toolsplayerclip Hammer mesh on Save VMAP.');
      if (grenade) grenade.closest('.toggle-row')?.setAttribute('title', 'Exports an exact-shape toolsgrenadeclip Hammer mesh on Save VMAP.');
      if (bullets) bullets.closest('.toggle-row')?.setAttribute('title', 'Exports an exact-shape toolsblockbullets_cs Hammer mesh on Save VMAP.');
      const title = [...host.querySelectorAll('.property-section-title')].find(element => element.textContent.trim() === 'Collision / Gameplay');
      const section = title?.closest('.property-section');
      if (section && !section.querySelector('.eph-collision-export-note-v25')) {
        const note = document.createElement('div');
        note.className = 'selection-info eph-collision-export-note-v25';
        note.textContent = 'Colliding controls the original mesh physics. Player / Grenade / Bullet blockers export separate Hammer tool-volume meshes with the same Part shape.';
        section.appendChild(note);
      }
      return result;
    };
    wrapped.__ephCollisionExportV25 = true;
    wrapped.__ephPrevious = rawRender;
    renderProperties = wrapped;
    window.renderProperties = wrapped;
    wrappedRenderProperties = wrapped;
  }

  function install() {
    installSaveExport();
    installTriggerDefaults();
    installPropertyExplanation();
  }

  install();
  // The old pass polled and rewrapped three functions every 250 ms for 15 s.
  // Project-dialog only needs a couple of late settling checks.
  [1000, 3000].forEach(delay => setTimeout(() => {
    if (VMAP.prepareForSave !== installedPrepare) installSaveExport();
    if (wrappedAddEntity && addEntity !== wrappedAddEntity) installTriggerDefaults();
    if (wrappedRenderProperties && renderProperties !== wrappedRenderProperties) installPropertyExplanation();
  }, delay));
})();
