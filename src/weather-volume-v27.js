// byanca
(() => {
  'use strict';
  if (window.__ephWeatherVolumeV27) return;
  window.__ephWeatherVolumeV27 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const TOOL_MATERIAL = 'materials/tools/toolstrigger.vmat';
  const WEATHER = new Map([
    ['particles/rain_fx/rain.vpcf', { label: 'Rain', precipType: '0' }],
    ['particles/rain_fx/snow.vpcf', { label: 'Snow', precipType: '1' }]
  ]);

  const lower = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase();
  const normalizedPath = value => {
    let path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (path.toLowerCase().endsWith('_c')) path = path.slice(0, -2);
    if (path && !path.toLowerCase().endsWith('.vpcf')) path += '.vpcf';
    return path;
  };
  const field = (element, key) => element?.fields?.find(item => item?.key === key) || null;
  const scalar = (element, key, fallback = '') => field(element, key)?.value ?? fallback;
  const elementId = element => String(scalar(element, 'id', ''));
  const entityPropsElement = element => {
    const value = field(element, 'entity_properties')?.value;
    return value?.kind === 'element' ? value : null;
  };
  const getProp = (props, key, fallback = '') => field(props, key)?.value ?? fallback;
  const setProp = (props, key, value, type = 'string') => {
    if (!props?.fields) return;
    let item = field(props, key);
    if (!item) {
      item = { key, type, value: String(value) };
      props.fields.push(item);
    } else {
      item.type = type || item.type;
      item.value = String(value);
    }
  };
  const setField = (element, key, type, value) => {
    if (!element?.fields) return;
    let item = field(element, key);
    if (!item) {
      item = { key, type, value: String(value) };
      element.fields.push(item);
    } else {
      item.type = type || item.type;
      item.value = String(value);
    }
  };
  const childArray = element => {
    let item = field(element, 'children');
    if (!item) {
      item = { key: 'children', type: 'element_array', value: [] };
      element.fields.push(item);
    }
    if (!Array.isArray(item.value)) item.value = [];
    return item.value;
  };

  function classify(path) {
    const normalized = normalizedPath(path);
    const info = WEATHER.get(lower(normalized));
    return info ? { ...info, path: normalized } : null;
  }

  function walk(element, fn) {
    if (!element?.kind) return;
    fn(element);
    for (const item of element.fields || []) {
      if (Array.isArray(item.value)) item.value.forEach(child => child?.kind && walk(child, fn));
      else if (item.value?.kind) walk(item.value, fn);
    }
  }

  function detachByDmxId(doc, dmxId) {
    const target = String(dmxId || '');
    const remove = element => {
      if (!element?.kind) return null;
      for (const item of element.fields || []) {
        if (Array.isArray(item.value)) {
          const index = item.value.findIndex(child => child?.kind && elementId(child) === target);
          if (index >= 0) return item.value.splice(index, 1)[0];
          for (const child of item.value) {
            const found = child?.kind ? remove(child) : null;
            if (found) return found;
          }
        } else if (item.value?.kind) {
          const found = remove(item.value);
          if (found) return found;
        }
      }
      return null;
    };
    for (const top of doc?.elements || []) {
      const found = remove(top);
      if (found) return found;
    }
    return null;
  }

  function addMapAssetReference(doc, resourcePath) {
    const prefix = doc?.elements?.find?.(element => element?.className === '$prefix_element$');
    if (!prefix?.fields) return;
    let item = field(prefix, 'map_asset_references');
    if (!item) {
      item = { key: 'map_asset_references', type: 'string_array', value: [] };
      prefix.fields.push(item);
    }
    if (!Array.isArray(item.value)) item.value = [];
    if (!item.value.some(value => lower(value) === lower(resourcePath))) item.value.push(resourcePath);
  }

  function precipitationRecords(doc) {
    const records = [];
    for (const top of doc?.elements || []) {
      walk(top, element => {
        if (element.className !== 'CMapEntity') return;
        const props = entityPropsElement(element);
        if (lower(getProp(props, 'classname')) !== 'func_precipitation') return;
        const precipType = String(getProp(props, 'preciptype', '0')) === '1' ? '1' : '0';
        const info = precipType === '1'
          ? { label: 'Snow', path: 'particles/rain_fx/snow.vpcf' }
          : { label: 'Rain', path: 'particles/rain_fx/rain.vpcf' };
        const mesh = childArray(element).find(child => child?.className === 'CMapMesh');
        if (!mesh) return;
        records.push({
          wrapperDmxId: elementId(element),
          meshDmxId: elementId(mesh),
          name: String(getProp(props, 'targetname', '')),
          precipType,
          density: String(getProp(props, 'renderamt', '5')),
          color: String(getProp(props, 'rendercolor', '255 255 255')),
          path: info.path,
          label: info.label
        });
      });
    }
    return records;
  }

  function nextWeatherName(label) {
    let highest = 0;
    const pattern = new RegExp(`^${String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`, 'i');
    for (const object of S?.objects || []) {
      const match = String(object?.name || '').match(pattern);
      if (match) highest = Math.max(highest, Number(match[1]) || 0);
    }
    return `${label}_${String(highest + 1).padStart(3, '0')}`;
  }

  function decorateWeatherObject(object, info, extras = {}) {
    if (!object || !info) return object;
    object.ephWeatherVolume = true;
    object.particleResource = info.path;
    object.weatherPrecipType = String(info.precipType);
    object.weatherDensity = String(extras.density ?? object.weatherDensity ?? '5');
    object.weatherColor = String(extras.color ?? object.weatherColor ?? '255 255 255');
    if (extras.wrapperDmxId) object.ephWeatherWrapperDmxId = String(extras.wrapperDmxId);
    object.collision = true;
    object.blockPlayers = false;
    object.blockGrenades = false;
    object.blockBullets = false;
    object.faceMaterials = (object.faces || []).map(() => TOOL_MATERIAL);
    object.materials ||= {};
    for (const name of VMAP.FACE_NAMES || ['right', 'left', 'front', 'back', 'top', 'bottom']) object.materials[name] = TOOL_MATERIAL;
    return object;
  }

  function add(item) {
    if (!S?.doc) return toast?.('Open a map first');
    const info = classify(item?.path);
    if (!info) return null;

    pushHistory?.();
    const materials = Object.fromEntries((VMAP.FACE_NAMES || ['right', 'left', 'front', 'back', 'top', 'bottom']).map(name => [name, TOOL_MATERIAL]));
    const object = ensureObject(VMAP.addPart(S.doc, {
      size: [512, 512, 256],
      position: [0, 0, 128],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      collision: true,
      materials,
      material: TOOL_MATERIAL
    }));
    if (!object) {
      S.undo?.pop?.();
      toast?.('Could not create weather volume');
      return null;
    }

    object.name = nextWeatherName(info.label);
    decorateWeatherObject(object, info);
    VMAP.applyObjectToDocument?.(S.doc, object);
    S.objects.push(object);
    S.selectedId = object.id;
    S.selectedFaces = new Set([0]);
    S.subSelection = null;
    S.viewport?.setObjects?.(S.objects, object.id);
    S.viewport?.select?.(object.id, false);
    setTool?.('move');
    markDirty?.(`Added ${info.label.toLowerCase()} volume`);
    renderTree?.();
    renderProperties?.();
    toast?.(`${info.label} volume added — move, rotate and scale the box to set the weather area`);
    return object;
  }

  function collapseImportedPrecipitation(doc, objects) {
    if (!Array.isArray(objects)) return objects;
    const records = precipitationRecords(doc);
    if (!records.length) return objects;
    const byDmx = new Map(objects.filter(object => object?.dmxId).map(object => [String(object.dmxId), object]));
    const removeIds = new Set();

    for (const record of records) {
      const wrapper = byDmx.get(record.wrapperDmxId);
      const mesh = byDmx.get(record.meshDmxId);
      if (!mesh) continue;
      const info = classify(record.path);
      decorateWeatherObject(mesh, info, {
        density: record.density,
        color: record.color,
        wrapperDmxId: record.wrapperDmxId
      });
      mesh.parent = 'world';
      mesh.ephMeshEntityChild = false;
      mesh.name = record.name || nextWeatherName(record.label);
      if (wrapper) removeIds.add(wrapper.id);
    }
    return objects.filter(object => !removeIds.has(object.id));
  }

  function configureWrapper(wrapperElement, object, info) {
    if (!wrapperElement) return;
    const props = entityPropsElement(wrapperElement);
    setProp(props, 'classname', 'func_precipitation');
    setProp(props, 'targetname', object.name || nextWeatherName(info.label));
    setProp(props, 'preciptype', info.precipType);
    setProp(props, 'renderamt', String(object.weatherDensity ?? '5'));
    setProp(props, 'rendercolor', String(object.weatherColor ?? '255 255 255'));
    setField(wrapperElement, 'origin', 'vector3', '0 0 0');
    setField(wrapperElement, 'angles', 'qangle', '0 0 0');
    setField(wrapperElement, 'scales', 'vector3', '1 1 1');
  }

  function exportWeatherVolumes(out, objects) {
    for (const object of objects || []) {
      if (!object?.ephWeatherVolume || !object?.dmxId) continue;
      const info = classify(object.particleResource)
        || (String(object.weatherPrecipType) === '1'
          ? { label: 'Snow', precipType: '1', path: 'particles/rain_fx/snow.vpcf' }
          : { label: 'Rain', precipType: '0', path: 'particles/rain_fx/rain.vpcf' });
      let wrapperElement = object.ephWeatherWrapperDmxId
        ? VMAP.findElementByDmxId?.(out, object.ephWeatherWrapperDmxId)
        : null;

      if (!wrapperElement) {
        const meshElement = detachByDmxId(out, object.dmxId);
        if (!meshElement) continue;
        const wrapperObject = VMAP.addEntity(out, {
          className: 'func_precipitation',
          name: object.name || nextWeatherName(info.label),
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          entityProperties: {}
        });
        wrapperElement = VMAP.findElementByDmxId?.(out, wrapperObject?.dmxId);
        if (!wrapperElement) continue;
        childArray(wrapperElement).push(meshElement);
      }

      configureWrapper(wrapperElement, object, info);
      addMapAssetReference(out, info.path);
    }
    return out;
  }

  function installExtract() {
    if (!VMAP.extractObjects || VMAP.extractObjects.__ephWeatherVolumeV27) return;
    const raw = VMAP.extractObjects.bind(VMAP);
    const wrapped = function(doc) {
      return collapseImportedPrecipitation(doc, raw(doc));
    };
    wrapped.__ephWeatherVolumeV27 = true;
    wrapped.__ephPrevious = raw;
    VMAP.extractObjects = wrapped;
  }

  function installPrepareForSave() {
    if (!VMAP.prepareForSave || VMAP.prepareForSave.__ephWeatherVolumeV27) return;
    const raw = VMAP.prepareForSave.bind(VMAP);
    const wrapped = function(doc, objects) {
      return exportWeatherVolumes(raw(doc, objects), objects);
    };
    wrapped.__ephWeatherVolumeV27 = true;
    wrapped.__ephPrevious = raw;
    VMAP.prepareForSave = wrapped;
  }

  function installDuplicate() {
    if (typeof duplicate !== 'function' || duplicate.__ephWeatherVolumeV27) return;
    const raw = duplicate;
    const wrapped = function(...args) {
      const source = current?.();
      const result = raw(...args);
      if (!source?.ephWeatherVolume || !result || result.type !== 'part') return result;
      const info = classify(source.particleResource)
        || (String(source.weatherPrecipType) === '1'
          ? { label: 'Snow', precipType: '1', path: 'particles/rain_fx/snow.vpcf' }
          : { label: 'Rain', precipType: '0', path: 'particles/rain_fx/rain.vpcf' });
      decorateWeatherObject(result, info, { density: source.weatherDensity, color: source.weatherColor });
      delete result.ephWeatherWrapperDmxId;
      result.name = nextWeatherName(info.label);
      VMAP.applyObjectToDocument?.(S.doc, result);
      markDirty?.(`Duplicated as ${result.name}`);
      renderTree?.();
      renderProperties?.();
      return result;
    };
    wrapped.__ephWeatherVolumeV27 = true;
    wrapped.__ephPrevious = raw;
    duplicate = wrapped;
    window.duplicate = wrapped;
  }

  function installDelete() {
    if (typeof removeSelected !== 'function' || removeSelected.__ephWeatherVolumeV27) return;
    const raw = removeSelected;
    const wrapped = function(...args) {
      const object = current?.();
      const wrapperDmxId = object?.ephWeatherVolume ? object.ephWeatherWrapperDmxId : null;
      const result = raw(...args);
      if (wrapperDmxId) VMAP.removeObject?.(S.doc, { dmxId: wrapperDmxId });
      return result;
    };
    wrapped.__ephWeatherVolumeV27 = true;
    wrapped.__ephPrevious = raw;
    removeSelected = wrapped;
    window.removeSelected = wrapped;
  }

  function changeWeather(object, precipType) {
    const info = String(precipType) === '1'
      ? { label: 'Snow', precipType: '1', path: 'particles/rain_fx/snow.vpcf' }
      : { label: 'Rain', precipType: '0', path: 'particles/rain_fx/rain.vpcf' };
    pushHistory?.();
    object.weatherPrecipType = info.precipType;
    object.particleResource = info.path;
    if (!String(object.name || '').match(/^(Rain|Snow)_\d+$/i)) object.name = nextWeatherName(info.label);
    markDirty?.(`Changed weather to ${info.label}`);
    renderTree?.();
    renderProperties?.();
  }

  function enhanceProperties() {
    const object = current?.();
    if (!object?.ephWeatherVolume) return;
    const host = document.getElementById('propertiesContent');
    if (!host || host.querySelector('.eph-weather-volume-v27')) return;
    const info = classify(object.particleResource)
      || (String(object.weatherPrecipType) === '1'
        ? { label: 'Snow', precipType: '1', path: 'particles/rain_fx/snow.vpcf' }
        : { label: 'Rain', precipType: '0', path: 'particles/rain_fx/rain.vpcf' });
    const badge = host.querySelector('.type-badge');
    if (badge) badge.textContent = 'weather volume';

    const section = document.createElement('div');
    section.className = 'property-section eph-weather-volume-v27';
    section.innerHTML = `
      <div class="property-section-title">Weather Particle Volume</div>
      <div class="field-row"><label>Weather</label><select id="ephWeatherTypeV27" class="prop-select"><option value="0" ${info.precipType === '0' ? 'selected' : ''}>Rain</option><option value="1" ${info.precipType === '1' ? 'selected' : ''}>Snow</option></select></div>
      <div class="field-row"><label>Particle</label><input class="prop-input" value="${String(info.path).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" readonly></div>
      <div class="field-row"><label>Density</label><input id="ephWeatherDensityV27" class="prop-input" type="number" min="0" max="100" step="1" value="${Math.max(0, Math.min(100, Number(object.weatherDensity) || 0))}"></div>
      <div class="field-row"><label>Tint</label><input id="ephWeatherColorV27" class="prop-input" type="text" value="${String(object.weatherColor || '255 255 255').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></div>
      <div class="selection-info">This box is the real precipitation volume. Move, rotate, and scale it: CS2 rain/snow is limited to this brush volume. EasyPeasyHammer keeps the volume and stock .vpcf together as one object.</div>`;
    host.appendChild(section);

    section.querySelector('#ephWeatherTypeV27').onchange = event => changeWeather(object, event.target.value);
    section.querySelector('#ephWeatherDensityV27').onchange = event => {
      pushHistory?.();
      object.weatherDensity = String(Math.max(0, Math.min(100, Number(event.target.value) || 0)));
      markDirty?.(`Changed ${info.label.toLowerCase()} density`);
    };
    section.querySelector('#ephWeatherColorV27').onchange = event => {
      pushHistory?.();
      object.weatherColor = String(event.target.value || '255 255 255').trim() || '255 255 255';
      markDirty?.(`Changed ${info.label.toLowerCase()} tint`);
    };
  }

  function installProperties() {
    if (typeof renderProperties !== 'function' || renderProperties.__ephWeatherVolumeV27) return;
    const raw = renderProperties;
    const wrapped = function(...args) {
      const result = raw(...args);
      queueMicrotask(enhanceProperties);
      return result;
    };
    for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
    wrapped.__ephWeatherVolumeV27 = true;
    wrapped.__ephPrevious = raw;
    renderProperties = wrapped;
    window.renderProperties = wrapped;
  }

  function install() {
    installExtract();
    installPrepareForSave();
    installDuplicate();
    installDelete();
    installProperties();
    for (const object of S?.objects || []) {
      if (!object?.ephWeatherVolume) continue;
      const info = classify(object.particleResource);
      if (info) decorateWeatherObject(object, info);
    }
    queueMicrotask(enhanceProperties);
  }

  install();
  window.addEventListener('eph-runtime-ready', install, { once: true });
  window.EPH_WEATHER_VOLUME = { classify, add, isWeatherPath: path => Boolean(classify(path)) };
  console.info('[Weather Volume V27] Native CS2 func_precipitation rain/snow volumes enabled.');
})();
