// byanca
(() => {
  'use strict';
  if (window.__ephWeatherVolumeV27) return;
  window.__ephWeatherVolumeV27 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const TOOL_MATERIAL = 'materials/tools/toolstrigger.vmat';
  const WEATHER = new Map([
    ['particles/rain_fx/rain.vpcf', { label: 'Rain', kind: 'rain' }],
    ['particles/rain_fx/snow.vpcf', { label: 'Snow', kind: 'snow' }]
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
    object.weatherKind = info.kind;
    object.weatherDensity = String(extras.density ?? object.weatherDensity ?? '100');
    object.weatherColor = String(extras.color ?? object.weatherColor ?? '255 255 255');
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
      toast?.('Could not create weather object');
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
    markDirty?.(`Added ${info.label.toLowerCase()} weather object`);
    renderTree?.();
    renderProperties?.();
    toast?.(`${info.label} weather object added`);
    return object;
  }

  function legacyPrecipitationRecords(doc) {
    const records = [];
    for (const top of doc?.elements || []) {
      walk(top, element => {
        if (element.className !== 'CMapEntity') return;
        const props = entityPropsElement(element);
        if (lower(getProp(props, 'classname')) !== 'func_precipitation') return;
        const kind = String(getProp(props, 'preciptype', '0')) === '1' ? 'snow' : 'rain';
        const info = kind === 'snow'
          ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
          : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' };
        const children = field(element, 'children')?.value;
        const mesh = Array.isArray(children) ? children.find(child => child?.className === 'CMapMesh') : null;
        if (!mesh) return;
        records.push({
          wrapperDmxId: elementId(element),
          meshDmxId: elementId(mesh),
          name: String(getProp(props, 'targetname', '')),
          density: String(getProp(props, 'renderamt', '100')),
          color: String(getProp(props, 'rendercolor', '255 255 255')),
          ...info
        });
      });
    }
    return records;
  }

  function collapseLegacyPrecipitation(doc, objects) {
    if (!Array.isArray(objects)) return objects;
    const records = legacyPrecipitationRecords(doc);
    if (!records.length) return objects;
    const byDmx = new Map(objects.filter(object => object?.dmxId).map(object => [String(object.dmxId), object]));
    const removeIds = new Set();
    for (const record of records) {
      const wrapper = byDmx.get(record.wrapperDmxId);
      const mesh = byDmx.get(record.meshDmxId);
      if (!mesh) continue;
      decorateWeatherObject(mesh, record, { density: record.density, color: record.color });
      mesh.parent = 'world';
      mesh.ephMeshEntityChild = false;
      mesh.name = record.name || nextWeatherName(record.label);
      if (wrapper) removeIds.add(wrapper.id);
    }
    return objects.filter(object => !removeIds.has(object.id));
  }

  function removeLegacyPrecipitation(out) {
    const ids = [];
    for (const top of out?.elements || []) walk(top, element => {
      if (element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      if (lower(getProp(props, 'classname')) === 'func_precipitation') ids.push(elementId(element));
    });
    for (const id of ids) detachByDmxId(out, id);
  }

  function ensureRainMapParameters(out, density = 100) {
    let found = null;
    for (const top of out?.elements || []) walk(top, element => {
      if (found || element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      if (lower(getProp(props, 'classname')) === 'info_map_parameters') found = element;
    });

    if (!found) {
      const added = VMAP.addEntity(out, {
        className: 'info_map_parameters',
        name: '',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        entityProperties: {}
      });
      found = VMAP.findElementByDmxId?.(out, added?.dmxId) || null;
    }

    const props = entityPropsElement(found);
    if (!props) return;
    setProp(props, 'raintracetoskyenabled', '1');
    setProp(props, 'envrainstrength', String(Math.max(0, Math.min(1, (Number(density) || 100) / 100))));
    setProp(props, 'envpuddleripplestrength', '1');
  }

  function addParticleEmitter(out, object, info) {
    const position = Array.isArray(object.position) ? object.position.map(Number) : [0, 0, 32];
    const rotation = Array.isArray(object.rotation) ? object.rotation.map(Number) : [0, 0, 0];
    VMAP.addEntity(out, {
      className: 'info_particle_system',
      name: `${object.name || info.label}_fx`,
      position,
      rotation,
      scale: [1, 1, 1],
      entityProperties: {
        effect_name: info.path,
        start_active: '1'
      }
    });
    addMapAssetReference(out, info.path);
  }

  function exportWeather(out, objects) {
    removeLegacyPrecipitation(out);
    let rainDensity = null;

    for (const object of objects || []) {
      if (!object?.ephWeatherVolume || !object?.dmxId) continue;
      const info = classify(object.particleResource)
        || (object.weatherKind === 'snow'
          ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
          : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' });

      // The EasyPeasyHammer box is editor-only. CS2 does not support Source 1's
      // func_precipitation volume entity. Export a real info_particle_system
      // instead and discard the helper brush from the runtime VMAP.
      detachByDmxId(out, object.dmxId);
      addParticleEmitter(out, object, info);
      if (info.kind === 'rain') rainDensity = Math.max(Number(rainDensity) || 0, Number(object.weatherDensity) || 100);
    }

    if (rainDensity != null) ensureRainMapParameters(out, rainDensity);
    return out;
  }

  function installExtract() {
    if (!VMAP.extractObjects || VMAP.extractObjects.__ephWeatherVolumeV27) return;
    const raw = VMAP.extractObjects.bind(VMAP);
    const wrapped = function(doc) {
      return collapseLegacyPrecipitation(doc, raw(doc));
    };
    wrapped.__ephWeatherVolumeV27 = true;
    wrapped.__ephPrevious = raw;
    VMAP.extractObjects = wrapped;
  }

  function installPrepareForSave() {
    if (!VMAP.prepareForSave || VMAP.prepareForSave.__ephWeatherVolumeV27) return;
    const raw = VMAP.prepareForSave.bind(VMAP);
    const wrapped = function(doc, objects) {
      return exportWeather(raw(doc, objects), objects);
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
        || (source.weatherKind === 'snow'
          ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
          : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' });
      decorateWeatherObject(result, info, { density: source.weatherDensity, color: source.weatherColor });
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

  function changeWeather(object, kind) {
    const info = String(kind) === 'snow'
      ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
      : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' };
    pushHistory?.();
    object.weatherKind = info.kind;
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
      || (object.weatherKind === 'snow'
        ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
        : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' });
    const badge = host.querySelector('.type-badge');
    if (badge) badge.textContent = 'weather';

    const section = document.createElement('div');
    section.className = 'property-section eph-weather-volume-v27';
    section.innerHTML = `
      <div class="property-section-title">CS2 Weather</div>
      <div class="field-row"><label>Weather</label><select id="ephWeatherTypeV27" class="prop-select"><option value="rain" ${info.kind === 'rain' ? 'selected' : ''}>Rain</option><option value="snow" ${info.kind === 'snow' ? 'selected' : ''}>Snow</option></select></div>
      <div class="field-row"><label>Particle</label><input class="prop-input" value="${String(info.path).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" readonly></div>
      <div class="field-row"><label>Density</label><input id="ephWeatherDensityV27" class="prop-input" type="number" min="0" max="100" step="1" value="${Math.max(0, Math.min(100, Number(object.weatherDensity) || 100))}"></div>
      <div class="selection-info">CS2 does not run Source 1 func_precipitation. EasyPeasyHammer exports this as info_particle_system; rain also enables info_map_parameters rain trace-to-sky. The box is an editor placement helper, not a guaranteed hard particle boundary.</div>`;
    host.appendChild(section);

    section.querySelector('#ephWeatherTypeV27').onchange = event => changeWeather(object, event.target.value);
    section.querySelector('#ephWeatherDensityV27').onchange = event => {
      pushHistory?.();
      object.weatherDensity = String(Math.max(0, Math.min(100, Number(event.target.value) || 0)));
      markDirty?.(`Changed ${info.label.toLowerCase()} density`);
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
  console.info('[Weather Volume V27] CS2 weather now exports real info_particle_system emitters; legacy func_precipitation is migrated out.');
})();
