// byanca
(() => {
  'use strict';
  if (window.__ephSolidEntityRuntimeV24) return;
  window.__ephSolidEntityRuntimeV24 = true;

  const api = window.easyPeasyHammer;
  const VMAP = window.EPH_VMAP;
  const TRIGGER_MATERIAL = 'materials/tools/toolstrigger.vmat';
  let viewport = null;
  let markerInstalledOn = null;
  let addEntityWrapped = null;
  let removeSelectedWrapped = null;

  const classKey = value => String(value || '').trim().toLowerCase();
  const metadataFor = className => Array.isArray(window.ENTITIES || ENTITIES)
    ? (window.ENTITIES || ENTITIES).find(item => classKey(item?.className) === classKey(className)) || null
    : null;

  function report(level, message, data = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Solid Entity V24] ${message}`, data || '');
    try { api?.appLog?.(level === 'warning' ? 'warning' : level, 'solid-entity-v24', message, data)?.catch?.(() => {}); } catch {}
  }

  function isSolidEntity(object) {
    if (!object || !['entity', 'prop'].includes(object.type)) return false;
    if (object.ephMeshEntity || (object.ephMeshChildIds?.length || 0) > 0) return true;
    return classKey(metadataFor(object.className)?.fgdKind || metadataFor(object.className)?.kind) === 'solid';
  }

  function isTriggerVolumeClass(className) {
    const name = classKey(className);
    return name.startsWith('trigger_') || [
      'func_bomb_target',
      'func_buyzone',
      'func_hostage_rescue',
    ].includes(name);
  }

  function childParts(wrapper) {
    if (!wrapper) return [];
    const ids = new Set(wrapper.ephMeshChildIds || []);
    for (const object of S?.objects || []) if (object?.parent === wrapper.id && object.type === 'part') ids.add(object.id);
    return [...ids]
      .map(id => S?.objects?.find(object => object.id === id))
      .filter(object => object?.type === 'part');
  }

  function chooseBombSite(wrapper) {
    const used = new Set();
    for (const object of S?.objects || []) {
      if (object === wrapper || classKey(object?.className) !== 'func_bomb_target') continue;
      const value = String(object?.entityProperties?.bomb_site_designation ?? '').trim();
      if (value === '0' || value === '1') used.add(value);
    }
    if (!used.has('0')) return '0';
    if (!used.has('1')) return '1';
    return '0';
  }

  function setTriggerMaterial(part) {
    if (!part?.faces?.length) return false;
    const next = part.faces.map(() => TRIGGER_MATERIAL);
    const already = Array.isArray(part.faceMaterials)
      && part.faceMaterials.length === next.length
      && part.faceMaterials.every(value => String(value) === TRIGGER_MATERIAL);
    if (already) return false;

    part.faceMaterials = next;
    part.materials ||= {};
    for (const name of VMAP?.FACE_NAMES || ['right', 'left', 'front', 'back', 'top', 'bottom']) part.materials[name] = TRIGGER_MATERIAL;
    VMAP?.applyObjectToDocument?.(S.doc, part);
    S.viewport?.updateObject?.(part);
    return true;
  }

  function configureBombTarget(wrapper) {
    if (classKey(wrapper?.className) !== 'func_bomb_target') return false;
    wrapper.entityProperties ||= {};
    let changed = false;
    const ensure = (key, value, allowEmpty = false) => {
      const exists = wrapper.entityProperties[key] !== undefined && wrapper.entityProperties[key] !== null;
      if (exists && (allowEmpty || String(wrapper.entityProperties[key]) !== '')) return;
      wrapper.entityProperties[key] = String(value);
      changed = true;
    };
    ensure('heistbomb', '0');
    ensure('bomb_mount_target', '', true);
    ensure('bomb_site_designation', chooseBombSite(wrapper));
    if (changed) VMAP?.applyObjectToDocument?.(S.doc, wrapper);
    return changed;
  }

  function configureSolid(wrapper, { newlyConverted = false, announce = false } = {}) {
    if (!wrapper || !isSolidEntity(wrapper)) return false;
    wrapper.ephMeshEntity = true;
    const children = childParts(wrapper);
    if (children.length) wrapper.ephMeshChildIds = children.map(part => part.id);

    let changed = false;
    if (newlyConverted && isTriggerVolumeClass(wrapper.className)) {
      for (const part of children) changed = setTriggerMaterial(part) || changed;
    }
    changed = configureBombTarget(wrapper) || changed;

    VMAP?.applyObjectToDocument?.(S.doc, wrapper);
    S.viewport?.updateObject?.(wrapper);

    if (announce) {
      const extra = classKey(wrapper.className) === 'func_bomb_target'
        ? ` Bomb site ${String(wrapper.entityProperties?.bomb_site_designation) === '1' ? 'B' : 'A'}.`
        : '';
      toast?.(`${wrapper.className} volume created.${extra}`);
    }
    if (changed && newlyConverted) markDirty?.(`Configured ${wrapper.className} volume`);
    report('normal', `Configured ${wrapper.className} mesh entity.`, {
      wrapper: wrapper.name || wrapper.id,
      children: children.map(part => part.name || part.id),
      triggerMaterial: newlyConverted && isTriggerVolumeClass(wrapper.className) ? TRIGGER_MATERIAL : null,
      bombSite: classKey(wrapper.className) === 'func_bomb_target' ? wrapper.entityProperties?.bomb_site_designation : null,
    });
    return changed;
  }

  function emptySolidMarker() {
    const THREE = window.EPH_THREE || window.THREE;
    if (!THREE) return null;
    const group = new THREE.Group();
    group.userData.ephVisual = true;
    group.userData.ephMeshEntityWrapper = true;
    return group;
  }

  function installMarker() {
    const vp = S?.viewport || window.EPH3D;
    if (!vp?.createEntityMarker) return false;
    viewport = vp;
    if (markerInstalledOn === vp && vp.createEntityMarker?.__ephSolidEntityV24) return true;

    const rawMarker = vp.createEntityMarker.bind(vp);
    const wrapped = function(object) {
      if (isSolidEntity(object)) return emptySolidMarker();
      return rawMarker(object);
    };
    wrapped.__ephSolidEntityV24 = true;
    wrapped.__ephHammerFinalV18 = true;
    wrapped.__ephPrevious = rawMarker;
    vp.createEntityMarker = wrapped;
    markerInstalledOn = vp;

    for (const object of S?.objects || []) if (isSolidEntity(object)) vp.updateObject?.(object);
    report('normal', 'Solid/volume entities now render their child mesh instead of a point ERROR helper.');
    return true;
  }

  function installAddEntity() {
    if (typeof addEntity !== 'function') return false;
    if (addEntity.__ephSolidEntityV24) return true;
    const rawAddEntity = addEntity;
    const wrapped = function(item = {}) {
      const beforeIds = new Set((S?.objects || []).map(object => object.id));
      const result = rawAddEntity(item);
      const className = classKey(item?.className);
      const wrapper = result && isSolidEntity(result)
        ? result
        : (S?.objects || []).find(object => !beforeIds.has(object.id) && classKey(object?.className) === className && isSolidEntity(object))
          || (isSolidEntity(current?.()) ? current() : null);
      if (wrapper) {
        configureSolid(wrapper, { newlyConverted: true, announce: true });
        installMarker();
        S.viewport?.setObjects?.(S.objects, wrapper.id);
        renderTree?.();
        renderProperties?.();
      }
      return result;
    };
    wrapped.__ephSolidEntityV24 = true;
    wrapped.__ephPrevious = rawAddEntity;
    addEntity = wrapped;
    window.addEntity = wrapped;
    addEntityWrapped = wrapped;
    return true;
  }

  function installDelete() {
    if (typeof removeSelected !== 'function') return false;
    if (removeSelected.__ephSolidEntityV24) return true;
    const rawRemove = removeSelected;
    const wrapped = function() {
      const object = current?.();
      if (!object?.dmxId || !isSolidEntity(object)) return rawRemove();
      const childIds = new Set(childParts(object).map(part => part.id));
      pushHistory?.();
      VMAP?.removeObject?.(S.doc, object);
      S.objects = (S.objects || []).filter(item => item.id !== object.id && !childIds.has(item.id));
      S.selectedId = 'world';
      S.selectedFaces = new Set([0]);
      S.subSelection = null;
      window.EPH_MULTI_SELECTION?.clear?.();
      S.viewport?.setObjects?.(S.objects, S.selectedId);
      markDirty?.(`Deleted ${object.name}`);
      renderTree?.();
      renderProperties?.();
      report('normal', `Deleted ${object.className} and its child mesh geometry.`, { children: [...childIds] });
    };
    wrapped.__ephSolidEntityV24 = true;
    wrapped.__ephPrevious = rawRemove;
    removeSelected = wrapped;
    window.removeSelected = wrapped;
    removeSelectedWrapped = wrapped;
    return true;
  }

  function setBombProperty(wrapper, key, value, label) {
    if (!wrapper || classKey(wrapper.className) !== 'func_bomb_target') return;
    pushHistory?.();
    wrapper.entityProperties ||= {};
    wrapper.entityProperties[key] = String(value);
    VMAP?.applyObjectToDocument?.(S.doc, wrapper);
    markDirty?.(`Changed ${label} on ${wrapper.name || wrapper.className}`);
    report('normal', `Bomb target ${key} changed.`, { value: String(value), name: wrapper.name || wrapper.id });
  }

  function decorateBombProperties() {
    const wrapper = current?.();
    if (!wrapper || classKey(wrapper.className) !== 'func_bomb_target') return;
    const host = document.getElementById('propertiesContent');
    if (!host || host.querySelector('.eph-bomb-target-v24')) return;
    configureBombTarget(wrapper);

    const section = document.createElement('div');
    section.className = 'property-section eph-bomb-target-v24';
    const site = String(wrapper.entityProperties?.bomb_site_designation ?? '0') === '1' ? '1' : '0';
    const heist = String(wrapper.entityProperties?.heistbomb ?? '0') !== '0';
    const mount = String(wrapper.entityProperties?.bomb_mount_target ?? '');
    section.innerHTML = `
      <div class="property-section-title">Bomb Site</div>
      <div class="field-row"><label>Site</label><select id="ephBombSiteV24" class="prop-select"><option value="0" ${site === '0' ? 'selected' : ''}>A</option><option value="1" ${site === '1' ? 'selected' : ''}>B</option></select></div>
      <label class="toggle-row"><span>Heist bomb target</span><input id="ephBombHeistV24" type="checkbox" ${heist ? 'checked' : ''}></label>
      <div class="field-row"><label>Bomb mount target</label><input id="ephBombMountV24" class="prop-input" type="text" value="${mount.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></div>
      <div class="selection-info">This is a Hammer mesh/volume entity. Edit the nested Part to resize the plant zone; the parent stores the gameplay KeyValues.</div>`;
    host.appendChild(section);

    section.querySelector('#ephBombSiteV24').onchange = event => setBombProperty(wrapper, 'bomb_site_designation', event.target.value, 'bomb site');
    section.querySelector('#ephBombHeistV24').onchange = event => setBombProperty(wrapper, 'heistbomb', event.target.checked ? '1' : '0', 'heist bomb');
    section.querySelector('#ephBombMountV24').onchange = event => setBombProperty(wrapper, 'bomb_mount_target', event.target.value, 'bomb mount target');
  }

  function repairCurrentProject() {
    if (!S?.doc || !Array.isArray(S.objects)) return;
    let repaired = 0;
    for (const object of S.objects) {
      if (!isSolidEntity(object)) continue;
      object.ephMeshEntity = true;
      const children = childParts(object);
      if (children.length) object.ephMeshChildIds = children.map(part => part.id);
      if (classKey(object.className) === 'func_bomb_target' && configureBombTarget(object)) repaired++;
    }
    if (repaired) {
      S.dirty = true;
      updateTitle?.();
      report('warning', `Repaired ${repaired} existing bomb target${repaired === 1 ? '' : 's'} with missing gameplay defaults. Save the VMAP to keep the repair.`);
    }
    installMarker();
    decorateBombProperties();
  }

  function ensureStyle() {
    if (document.getElementById('ephSolidEntityV24Style')) return;
    const style = document.createElement('style');
    style.id = 'ephSolidEntityV24Style';
    style.textContent = `
      .eph-bomb-target-v24 .field-row{display:grid;grid-template-columns:minmax(90px,auto) minmax(0,1fr);gap:8px;align-items:center;margin:6px 0}
      .eph-bomb-target-v24 .toggle-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 0;color:#ddd}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (typeof S === 'undefined' || !VMAP) return false;
    ensureStyle();
    installMarker();
    installAddEntity();
    installDelete();
    repairCurrentProject();
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', () => { markerInstalledOn = null; install(); });
  const properties = document.getElementById('propertiesContent');
  if (properties) {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; decorateBombProperties(); });
    }).observe(properties, { childList: true });
  }

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    installMarker();
    if (addEntityWrapped && addEntity !== addEntityWrapped) installAddEntity();
    if (removeSelectedWrapped && removeSelected !== removeSelectedWrapped) installDelete();
    decorateBombProperties();
    if (checks >= 60) clearInterval(guard);
  }, 250);

  report('normal', 'Solid entity runtime installed.');
})();
