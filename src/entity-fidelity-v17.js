// byanca
(() => {
  'use strict';

  if (window.__ephEntityFidelityV17) return;
  window.__ephEntityFidelityV17 = true;

  const THREE = window.THREE;
  const VMAP = window.EPH_VMAP;
  const missingModels = new Set();
  const missingMaterials = new Set();

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'entity-fidelity-v17.css';
  document.head.appendChild(style);

  function metadataFor(className) {
    const key = String(className || '').toLowerCase();
    return Array.isArray(ENTITIES) ? ENTITIES.find(item => String(item?.className || '').toLowerCase() === key) || null : null;
  }

  function reservedKey(key) {
    return ['id', 'classname', 'targetname', 'model'].includes(String(key || '').toLowerCase());
  }

  function propertyDefaults(item) {
    const output = {};
    for (const property of item?.properties || []) {
      if (!property?.key || reservedKey(property.key)) continue;
      if (property.default !== undefined && property.default !== null && String(property.default) !== '') output[property.key] = String(property.default);
    }
    return output;
  }

  function reportMissing(kind, resource, object) {
    const name = String(resource || '').trim();
    if (!name) return;
    const set = kind === 'model' ? missingModels : missingMaterials;
    if (set.has(name)) return;
    set.add(name);
    const owner = object?.className || object?.name || object?.id || 'object';
    console.warn(`Missing ${kind}: ${name} (${owner}). Showing ERROR fallback; the map remains open.`);
  }

  function removeModelsTab() {
    const models = document.querySelector('#assetTabs [data-tab="models"]');
    if (models) models.remove();
    if (S?.assetTab === 'models') {
      S.assetTab = 'props';
      queueAssetSearch?.(true);
    }
  }

  function errorBox(viewport, size = [28, 28, 28]) {
    const geometry = new THREE.BoxGeometry(Math.max(.01, size[0]), Math.max(.01, size[1]), Math.max(.01, size[2]));
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, metalness: 0, map: viewport.errorTexture || null });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.ephErrorFallback = true;
    return mesh;
  }

  function cloneSharedModel(data) {
    const model = data.scene.clone(true);
    model.rotation.x = Math.PI / 2;
    model.scale.setScalar(Number(data.scale) || 39.37007874015748);
    model.traverse(child => {
      if (!child.isMesh) return;
      child.userData.sharedGeometry = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) if (material?.userData) material.userData.sharedMaterial = true;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    return model;
  }

  function modelVisual(viewport, object, resource) {
    const group = new THREE.Group();
    group.userData.ephVisual = true;
    const fallback = errorBox(viewport, object?.size || [32, 32, 48]);
    group.add(fallback);
    viewport.loadModel(resource).then(data => {
      if (!group.parent && !group.userData.ephAllowDetachedLoad) return;
      if (!data?.scene) { reportMissing('model', resource, object); return; }
      try {
        const model = cloneSharedModel(data);
        group.remove(fallback);
        viewport.disposeObject?.(fallback);
        group.add(model);
        if (viewport.selectedId === object?.id) viewport.updateSelectionBox?.();
      } catch (error) {
        console.error(`Could not display model ${resource}`, error);
      }
    }).catch(error => {
      reportMissing('model', resource, object);
      console.error(`Model preview failed: ${resource}`, error);
    });
    return group;
  }

  function spriteVisual(viewport, object, hint) {
    const group = new THREE.Group();
    group.userData.ephVisual = true;
    const fallback = errorBox(viewport, [22, 22, 22]);
    group.add(fallback);
    const resource = hint?.resource || '';
    viewport.loadMaterialTexture(resource).then(texture => {
      if (!texture) { reportMissing('material', resource, object); return; }
      const material = new THREE.SpriteMaterial({ map: texture, color: 0xffffff, transparent: true, depthTest: false, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      const bounds = hint?.bounds;
      const sx = bounds ? Math.max(12, Math.abs(bounds.max[0] - bounds.min[0])) : 32;
      const sy = bounds ? Math.max(12, Math.abs(bounds.max[2] - bounds.min[2])) : 32;
      sprite.scale.set(sx, sy, 1);
      sprite.renderOrder = 800;
      group.remove(fallback);
      viewport.disposeObject?.(fallback);
      group.add(sprite);
      if (viewport.selectedId === object?.id) viewport.updateSelectionBox?.();
    }).catch(error => {
      reportMissing('material', resource, object);
      console.error(`Entity sprite failed: ${resource}`, error);
    });
    return group;
  }

  function wireVisual(object, hint) {
    const bounds = hint?.bounds || { min: [-8, -8, -8], max: [8, 8, 8] };
    const min = bounds.min || [-8, -8, -8];
    const max = bounds.max || [8, 8, 8];
    const size = [Math.max(.01, max[0] - min[0]), Math.max(.01, max[1] - min[1]), Math.max(.01, max[2] - min[2])];
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(...size));
    const color = Array.isArray(hint?.color) && hint.color.length >= 3
      ? new THREE.Color(Math.min(255, hint.color[0]) / 255, Math.min(255, hint.color[1]) / 255, Math.min(255, hint.color[2]) / 255)
      : new THREE.Color(0xffffff);
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: .95 }));
    line.position.set(...center);
    line.renderOrder = 700;
    line.userData.ephVisual = true;
    return line;
  }

  function installViewport(viewport = S?.viewport || window.EPH3D) {
    if (!viewport || !THREE || viewport.__ephEntityFidelityV17) return;
    viewport.__ephEntityFidelityV17 = true;

    if (typeof viewport.loadModel === 'function') {
      const rawLoadModel = viewport.loadModel.bind(viewport);
      viewport.loadModel = async function(resource) {
        const result = await rawLoadModel(resource);
        if (!result && resource) reportMissing('model', resource);
        return result;
      };
    }

    if (typeof viewport.loadMaterialTexture === 'function') {
      const rawLoadMaterial = viewport.loadMaterialTexture.bind(viewport);
      viewport.loadMaterialTexture = async function(resource) {
        const result = await rawLoadMaterial(resource);
        if (!result && resource && resource !== 'ERROR') reportMissing('material', resource);
        return result;
      };
    }

    if (typeof viewport.createFaceMaterial === 'function') {
      const rawFaceMaterial = viewport.createFaceMaterial.bind(viewport);
      viewport.createFaceMaterial = function(resource) {
        const material = rawFaceMaterial(resource);
        const value = String(resource || 'ERROR');
        if (value !== 'ERROR' && !/error|missing/i.test(value)) {
          this.loadMaterialTexture(value).then(texture => {
            if (texture || material.userData?.disposed) return;
            material.map = this.errorTexture || null;
            material.color?.set?.(0xffffff);
            material.needsUpdate = true;
          }).catch(() => {});
        }
        return material;
      };
    }

    if (typeof viewport.createPropVisual === 'function') {
      const rawProp = viewport.createPropVisual.bind(viewport);
      viewport.createPropVisual = function(object, root) {
        const visual = rawProp(object, root);
        visual?.traverse?.(child => {
          if (!child.userData?.placeholder || !child.material) return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            material.map = this.errorTexture || null;
            material.color?.set?.(0xffffff);
            material.opacity = 1;
            material.transparent = false;
            material.needsUpdate = true;
          }
        });
        return visual;
      };
    }

    viewport.createEntityMarker = function(object) {
      const meta = metadataFor(object?.className);
      const model = String(object?.model || object?.entityProperties?.model || meta?.model || '').trim();
      const hint = meta?.renderHint || null;
      if (model) return modelVisual(this, object, model);
      if (hint?.resource && ['iconsprite', 'sprite'].includes(String(hint.type || '').toLowerCase())) return spriteVisual(this, object, hint);
      if (hint?.bounds || ['bbox', 'wirebox'].includes(String(hint?.type || '').toLowerCase())) return wireVisual(object, hint);
      console.warn(`No Hammer FGD visual for ${object?.className || 'unknown entity'}; showing ERROR helper.`);
      return errorBox(this, [24, 24, 24]);
    };

    for (const object of S?.objects || []) if (['entity', 'prop'].includes(object?.type)) viewport.updateObject?.(object);
  }

  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const elementId = element => String(field(element, 'id')?.value || '');
  function childArray(element) {
    let children = field(element, 'children');
    if (!children) { children = { key: 'children', type: 'element_array', value: [] }; element.fields.push(children); }
    if (!Array.isArray(children.value)) children.value = [];
    return children.value;
  }
  function detachById(element, targetId) {
    if (!element?.kind) return null;
    for (const item of element.fields || []) {
      if (Array.isArray(item.value)) {
        const index = item.value.findIndex(child => child?.kind && elementId(child) === targetId);
        if (index >= 0) return item.value.splice(index, 1)[0];
        for (const child of item.value) { const found = detachById(child, targetId); if (found) return found; }
      } else if (item.value?.kind) {
        const found = detachById(item.value, targetId); if (found) return found;
      }
    }
    return null;
  }

  function applyDefaults(object, item) {
    if (!object) return;
    object.entityProperties ||= {};
    for (const [key, value] of Object.entries(propertyDefaults(item))) if (!(key in object.entityProperties)) object.entityProperties[key] = value;
    object.ephFgdClass = item?.className || object.className;
    object.ephFgdSource = item?.fgdSource || item?.source || 'CS2 FGD';
  }

  function convertSelectedPartToSolid(item) {
    const part = current?.();
    if (!part || part.type !== 'part' || !part.dmxId) { toast?.(`${item?.name || item?.className || 'Solid entity'}: select a Part first.`); return null; }
    const meshElement = VMAP.findElementByDmxId?.(S.doc, part.dmxId);
    if (!meshElement || meshElement.className !== 'CMapMesh') return toast?.('The selected Part could not be converted to a Hammer solid entity.'), null;

    pushHistory?.();
    const defaults = propertyDefaults(item);
    const className = String(item?.className || 'func_brush');
    const wrapper = ensureObject(VMAP.addEntity(S.doc, {
      className,
      name: `${className}_${String(S.objects.filter(object => object?.className === className).length + 1).padStart(2, '0')}`,
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], entityProperties: defaults,
    }));
    const wrapperElement = VMAP.findElementByDmxId?.(S.doc, wrapper?.dmxId);
    if (!wrapper || !wrapperElement) { S.undo?.pop?.(); return null; }
    const root = { kind: 'root', fields: [{ key: 'elements', value: S.doc.elements }] };
    const detached = detachById(root, String(part.dmxId));
    if (!detached) { VMAP.removeObject?.(S.doc, wrapper); S.undo?.pop?.(); return toast?.('Could not move the Part into the Hammer entity.'), null; }

    childArray(wrapperElement).push(detached);
    applyDefaults(wrapper, item);
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
    return wrapper;
  }

  function installAddEntity() {
    if (typeof addEntity !== 'function' || addEntity.__ephEntityFidelityV17) return;
    const rawAddEntity = addEntity;
    addEntity = function(item = {}) {
      if (item?.fgdKind === 'solid') return convertSelectedPartToSolid(item);
      const before = S.selectedId;
      const result = rawAddEntity(item);
      const object = current?.();
      if (object && object.id !== before && object.className === item.className) {
        applyDefaults(object, item);
        if (!object.model && item.model) object.model = item.model;
        VMAP.applyObjectToDocument(S.doc, object);
        S.viewport?.updateObject?.(object);
        renderProperties?.();
      }
      return result;
    };
    addEntity.__ephEntityFidelityV17 = true;
    window.addEntity = addEntity;
  }

  function propertyInput(property, value) {
    const type = String(property?.type || '').toLowerCase();
    const key = property.key, label = property.label || key, description = property.description || '';
    const choices = Array.isArray(property.choices) ? property.choices : [];
    if (choices.length) {
      const values = new Set(choices.map(choice => String(choice.value)));
      const options = [];
      if (value !== '' && !values.has(String(value))) options.push(`<option value="${esc(value)}" selected>${esc(value)}</option>`);
      for (const choice of choices) options.push(`<option value="${esc(choice.value)}" ${String(choice.value) === String(value) ? 'selected' : ''}>${esc(choice.label || choice.value)}</option>`);
      return `<div class="eph-fgd-row" title="${esc(description)}"><label>${esc(label)}</label><select class="prop-select eph-fgd-input" data-fgd-key="${esc(key)}">${options.join('')}</select></div>`;
    }
    const numeric = /(?:integer|float|angle|node_id|halfgridsnap)/.test(type);
    return `<div class="eph-fgd-row" title="${esc(description)}"><label>${esc(label)}</label><input class="prop-input eph-fgd-input" data-fgd-key="${esc(key)}" ${numeric ? 'type="number" step="any"' : 'type="text"'} value="${esc(value)}" placeholder="${esc(property.default || '')}"></div>`;
  }

  function schemaHtml(object, meta) {
    const properties = (meta?.properties || []).filter(property => property?.key && !reservedKey(property.key));
    if (!properties.length) return '';
    object.entityProperties ||= {};
    return `<div class="property-section eph-fgd-properties">
      <div class="property-section-title">Hammer / FGD Properties</div>
      <div class="selection-info">Loaded from ${esc(meta.fgdSource || 'the installed CS2 FGD')}. These are the fields Hammer defines for <code>${esc(meta.className)}</code>, including inherited base properties.</div>
      <div class="eph-fgd-list">${properties.map(property => {
        const currentValue = Object.prototype.hasOwnProperty.call(object.entityProperties, property.key) ? object.entityProperties[property.key] : '';
        return propertyInput(property, currentValue);
      }).join('')}</div>
    </div>`;
  }

  function installProperties() {
    if (typeof renderProperties !== 'function' || renderProperties.__ephEntityFidelityV17) return;
    const rawRender = renderProperties;
    renderProperties = function(...args) {
      const result = rawRender(...args);
      const object = current?.();
      const host = document.getElementById('propertiesContent');
      if (!object || !host || !['entity', 'prop'].includes(object.type)) return result;
      const meta = metadataFor(object.className);
      if (!meta) return result;
      const compat = host.querySelector('.eph-entity-compat-section');
      const html = schemaHtml(object, meta);
      if (html && !host.querySelector('.eph-fgd-properties')) {
        if (compat) compat.insertAdjacentHTML('beforebegin', html); else host.insertAdjacentHTML('beforeend', html);
      }
      const schemaKeys = new Set((meta.properties || []).map(property => String(property.key || '').toLowerCase()));
      if (compat) {
        const title = compat.querySelector('.property-section-title');
        if (title) title.textContent = 'Other / Raw KeyValues';
        compat.querySelectorAll('.eph-entity-kv-row').forEach(row => { if (schemaKeys.has(String(row.dataset.originalKey || '').toLowerCase())) row.hidden = true; });
      }
      host.querySelectorAll('.eph-fgd-input').forEach(input => {
        input.onchange = () => {
          const key = input.dataset.fgdKey;
          if (!key) return;
          pushHistory?.();
          object.entityProperties ||= {};
          object.entityProperties[key] = String(input.value ?? '');
          VMAP.applyObjectToDocument(S.doc, object);
          S.viewport?.updateObject?.(object);
          markDirty?.(`Changed ${key} on ${object.name}`);
        };
      });
      return result;
    };
    renderProperties.__ephEntityFidelityV17 = true;
    window.renderProperties = renderProperties;
  }

  async function hydrateFgdCatalog() {
    try {
      const result = await window.easyPeasyHammer?.getEntityCatalog?.();
      if (!result?.ok || !Array.isArray(result.entities)) {
        if (result?.error) console.warn(`FGD catalog unavailable: ${result.error}`);
        return;
      }
      const known = new Map(ENTITIES.map(item => [String(item?.className || '').toLowerCase(), item]));
      let added = 0;
      for (const entity of result.entities) {
        const className = String(entity?.className || '').trim();
        if (!className) continue;
        const key = className.toLowerCase();
        let item = known.get(key);
        if (!item) {
          item = { name: entity.name || className, className, kind: 'entity', source: 'CS2 FGD' };
          ENTITIES.push(item); known.set(key, item); added++;
        }
        item.fgdKind = entity.kind || 'point';
        item.model ||= entity.model || '';
        item.renderHint = entity.renderHint || item.renderHint || null;
        item.properties = Array.isArray(entity.properties) ? entity.properties : (item.properties || []);
        item.baseClasses = Array.isArray(entity.baseClasses) ? entity.baseClasses : [];
        item.fgdSource = entity.sourceFile || item.fgdSource || 'CS2 FGD';
        item.source ||= 'CS2 FGD';
      }
      ENTITIES.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.className || '').localeCompare(String(b.className || '')));
      console.info(`Hammer FGD metadata loaded: ${Number(result.pointEntities || 0)} point + ${Number(result.solidEntities || 0)} solid entities from ${Number(result.fgdFiles || 0)} files${added ? `; ${added} newly added` : ''}.`);
      refreshFgdVisuals();
      window.dispatchEvent(new CustomEvent('eph-fgd-catalog-ready', { detail: result }));
    } catch (error) {
      console.error('Could not hydrate Hammer FGD metadata', error);
    }
  }

  function refreshFgdVisuals() {
    removeModelsTab();
    installAddEntity();
    installProperties();
    installViewport();
    if (S?.assetTab === 'entities') queueAssetSearch?.(true);
    for (const object of S?.objects || []) if (['entity', 'prop'].includes(object?.type)) S.viewport?.updateObject?.(object);
    renderProperties?.();
  }

  removeModelsTab();
  installAddEntity();
  installProperties();
  installViewport();
  window.addEventListener('eph3d-ready', event => installViewport(event.detail), { once: true });
  window.addEventListener('eph-fgd-catalog-ready', refreshFgdVisuals);
  hydrateFgdCatalog();
  setTimeout(refreshFgdVisuals, 700);
  setTimeout(refreshFgdVisuals, 2200);
})();
