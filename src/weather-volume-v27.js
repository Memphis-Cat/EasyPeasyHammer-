// byanca
(() => {
  'use strict';
  if (window.__ephWeatherVolumeV27) return;
  window.__ephWeatherVolumeV27 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const TOOL_MATERIAL = 'materials/tools/toolsprecipitation.vmat';
  const ZONE_PREFIX = 'EPH_WEATHER_ZONE_';
  const FX_PREFIX = 'EPH_WEATHER_FX_';
  const MAP_PARAMS_NAME = 'EPH_WEATHER_MAP_PARAMS';
  const WEATHER = new Map([
    ['particles/rain_fx/rain.vpcf', { label: 'Rain', kind: 'rain', subclass: 'precipitation_rain', preciptype: '4' }],
    ['particles/rain_fx/snow.vpcf', { label: 'Snow', kind: 'snow', subclass: 'precipitation_snow', preciptype: '9' }]
  ]);

  const lower = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase();
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
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
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function normalizedPath(value) {
    let path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (path.toLowerCase().endsWith('_c')) path = path.slice(0, -2);
    if (path && !path.toLowerCase().endsWith('.vpcf')) path += '.vpcf';
    return path;
  }

  function infoForKind(kind) {
    return String(kind).toLowerCase() === 'snow'
      ? { label: 'Snow', kind: 'snow', subclass: 'precipitation_snow', preciptype: '9', path: 'particles/rain_fx/snow.vpcf' }
      : { label: 'Rain', kind: 'rain', subclass: 'precipitation_rain', preciptype: '4', path: 'particles/rain_fx/rain.vpcf' };
  }

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

  function settingsFromMarker(name) {
    const match = String(name || '').match(/^EPH_WEATHER_ZONE_(rain|snow)_d(\d+)(?:_s(\d+))?_a([01])(?:_|$)/i);
    if (!match) return null;
    return {
      kind: match[1].toLowerCase(),
      density: String(clamp(match[2], 0, 100)),
      spacing: String(clamp(match[3] || 192, 64, 2048)),
      startActive: match[4] !== '0'
    };
  }

  function markerName(object, info) {
    const density = Math.round(clamp(object.weatherDensity ?? 70, 0, 100));
    const spacing = Math.round(clamp(object.weatherSpacing ?? 192, 64, 2048));
    const active = object.weatherStartActive === false ? 0 : 1;
    const suffix = String(object.dmxId || '').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'zone';
    return `${ZONE_PREFIX}${info.kind}_d${density}_s${spacing}_a${active}_${suffix}`;
  }

  function decorateWeatherObject(object, info, extras = {}) {
    if (!object || !info) return object;
    object.ephWeatherVolume = true;
    object.particleResource = info.path;
    object.weatherKind = info.kind;
    object.weatherDensity = String(clamp(extras.density ?? object.weatherDensity ?? 70, 0, 100));
    object.weatherSpacing = String(clamp(extras.spacing ?? object.weatherSpacing ?? 192, 64, 2048));
    object.weatherStartActive = extras.startActive ?? object.weatherStartActive ?? true;
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
      material: TOOL_MATERIAL,
      meshName: `${ZONE_PREFIX}${info.kind}_d70_s192_a1_new`
    }));
    if (!object) {
      S.undo?.pop?.();
      toast?.('Could not create weather zone');
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
    markDirty?.(`Added ${info.label.toLowerCase()} zone`);
    renderTree?.();
    renderProperties?.();
    toast?.(`${info.label} zone added — scale the box to define the precipitation volume`);
    return object;
  }

  function weatherRecords(doc) {
    const zones = [];
    const generatedIds = new Set();
    const native = [];

    for (const top of doc?.elements || []) walk(top, element => {
      if (element.className === 'CMapMesh') {
        const meshData = field(element, 'meshData')?.value;
        const name = String(scalar(meshData, 'name', ''));
        if (name.startsWith(ZONE_PREFIX)) {
          const settings = settingsFromMarker(name);
          if (settings) zones.push({ dmxId: elementId(element), ...settings });
        }
        return;
      }
      if (element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      const className = lower(getProp(props, 'classname'));
      const targetname = String(getProp(props, 'targetname', ''));
      const effect = lower(getProp(props, 'effect_name', ''));

      if (targetname.startsWith(FX_PREFIX)
        || /^(?:rain|snow)_\d+_fx_\d+$/i.test(targetname)
        || targetname === MAP_PARAMS_NAME) {
        generatedIds.add(elementId(element));
      }

      if (className !== 'func_precipitation') return;
      const subclass = lower(getProp(props, 'subclass_name', ''));
      const preciptype = String(getProp(props, 'preciptype', ''));
      const kind = subclass.includes('snow') || preciptype === '9' || preciptype === '1' ? 'snow' : 'rain';
      const children = field(element, 'children')?.value;
      const mesh = Array.isArray(children) ? children.find(child => child?.className === 'CMapMesh') : null;
      if (!mesh) return;
      native.push({
        wrapperDmxId: elementId(element),
        meshDmxId: elementId(mesh),
        kind,
        density: String(clamp(getProp(props, 'renderamt', '70'), 0, 100)),
        spacing: '192',
        startActive: String(getProp(props, 'StartDisabled', '0')) !== '1',
        name: targetname
      });

      if (className === 'info_particle_system' && (effect === lower(WEATHER.get('particles/rain_fx/rain.vpcf')) || effect === lower(WEATHER.get('particles/rain_fx/snow.vpcf')))) generatedIds.add(elementId(element));
    });

    return { zones, generatedIds, native };
  }

  function collapseWeatherOnExtract(doc, extracted) {
    if (!Array.isArray(extracted)) return extracted;
    const records = weatherRecords(doc);
    const byDmx = new Map(extracted.filter(object => object?.dmxId).map(object => [String(object.dmxId), object]));
    const removeIds = new Set();

    for (const record of records.zones) {
      const object = byDmx.get(record.dmxId);
      if (!object) continue;
      decorateWeatherObject(object, infoForKind(record.kind), record);
      if (!/^(?:Rain|Snow)_\d+$/i.test(String(object.name || ''))) object.name = nextWeatherName(infoForKind(record.kind).label);
    }

    for (const record of records.native) {
      const mesh = byDmx.get(record.meshDmxId);
      const wrapper = byDmx.get(record.wrapperDmxId);
      if (!mesh) continue;
      const info = infoForKind(record.kind);
      decorateWeatherObject(mesh, info, { ...record, wrapperDmxId: record.wrapperDmxId });
      mesh.parent = 'world';
      mesh.ephMeshEntityChild = false;
      mesh.name = record.name || nextWeatherName(info.label);
      if (wrapper) removeIds.add(wrapper.id);
    }

    for (const id of records.generatedIds) {
      const object = byDmx.get(id);
      if (object) removeIds.add(object.id);
    }
    return extracted.filter(object => !removeIds.has(object.id));
  }

  function removeOldGeneratedEntities(out) {
    const ids = [];
    for (const top of out?.elements || []) walk(top, element => {
      if (element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      const className = lower(getProp(props, 'classname'));
      const targetname = String(getProp(props, 'targetname', ''));
      const effect = lower(getProp(props, 'effect_name', ''));
      const oldWeatherFx = className === 'info_particle_system'
        && (effect === 'particles/rain_fx/rain.vpcf' || effect === 'particles/rain_fx/snow.vpcf')
        && (targetname.startsWith(FX_PREFIX) || /^(?:rain|snow)_\d+_fx_\d+$/i.test(targetname));
      if (oldWeatherFx || targetname === MAP_PARAMS_NAME) ids.push(elementId(element));
    });
    for (const id of ids) detachByDmxId(out, id);
  }

  function configureWeatherMesh(mesh, object, info) {
    if (!mesh) return;
    setField(mesh, 'editorOnly', 'bool', '0');
    setField(mesh, 'physicsType', 'string', 'default');
    setField(mesh, 'force_hidden', 'bool', object.visible === false ? '1' : '0');
    const meshData = field(mesh, 'meshData')?.value;
    if (meshData?.fields) {
      setField(meshData, 'name', 'string', markerName(object, info));
      const materials = field(meshData, 'materials');
      if (materials) materials.value = [TOOL_MATERIAL];
    }
  }

  function configureWrapper(wrapper, object, info) {
    if (!wrapper) return;
    const props = entityPropsElement(wrapper);
    setProp(props, 'classname', 'func_precipitation');
    setProp(props, 'targetname', object.name || nextWeatherName(info.label));
    setProp(props, 'subclass_name', info.subclass);
    setProp(props, 'preciptype', info.preciptype);
    setProp(props, 'renderamt', String(Math.round(clamp(object.weatherDensity ?? 70, 0, 100))));
    setProp(props, 'spawnflags', '1');
    setProp(props, 'StartDisabled', object.weatherStartActive === false ? '1' : '0');
    setField(wrapper, 'origin', 'vector3', '0 0 0');
    setField(wrapper, 'angles', 'qangle', '0 0 0');
    setField(wrapper, 'scales', 'vector3', '1 1 1');
    setField(wrapper, 'editorOnly', 'bool', '0');
    setField(wrapper, 'force_hidden', 'bool', object.visible === false ? '1' : '0');
  }

  function ensureRainMapParameters(out, density = 70) {
    let found = null;
    for (const top of out?.elements || []) walk(top, element => {
      if (found || element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      if (lower(getProp(props, 'classname')) === 'info_map_parameters') found = element;
    });

    if (!found) {
      const added = VMAP.addEntity(out, {
        className: 'info_map_parameters',
        name: MAP_PARAMS_NAME,
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
    setProp(props, 'envrainstrength', String(clamp(density, 0, 100) / 100));
    setProp(props, 'envpuddleripplestrength', '1');
  }

  function exportWeather(out, objects) {
    removeOldGeneratedEntities(out);
    let strongestRain = null;

    for (const object of objects || []) {
      if (!object?.ephWeatherVolume || !object?.dmxId) continue;
      const info = classify(object.particleResource) || infoForKind(object.weatherKind);
      let wrapper = object.ephWeatherWrapperDmxId
        ? VMAP.findElementByDmxId?.(out, object.ephWeatherWrapperDmxId)
        : null;
      let mesh = VMAP.findElementByDmxId?.(out, object.dmxId);

      if (!wrapper || wrapper.className !== 'CMapEntity') {
        mesh = detachByDmxId(out, object.dmxId) || mesh;
        if (!mesh) continue;
        const wrapperObject = VMAP.addEntity(out, {
          className: 'func_precipitation',
          name: object.name || nextWeatherName(info.label),
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          entityProperties: {}
        });
        wrapper = VMAP.findElementByDmxId?.(out, wrapperObject?.dmxId) || null;
        if (!wrapper) continue;
        childArray(wrapper).push(mesh);
      } else {
        mesh = VMAP.findElementByDmxId?.(out, object.dmxId) || childArray(wrapper).find(child => child?.className === 'CMapMesh');
      }

      configureWeatherMesh(mesh, object, info);
      configureWrapper(wrapper, object, info);
      addMapAssetReference(out, info.path);
      if (info.kind === 'rain') strongestRain = Math.max(Number(strongestRain) || 0, clamp(object.weatherDensity ?? 70, 0, 100));
    }

    if (strongestRain != null) ensureRainMapParameters(out, strongestRain);
    return out;
  }

  function installExtract() {
    if (!VMAP.extractObjects || VMAP.extractObjects.__ephWeatherVolumeV27) return;
    const raw = VMAP.extractObjects.bind(VMAP);
    const wrapped = function(doc) {
      return collapseWeatherOnExtract(doc, raw(doc));
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
      const info = classify(source.particleResource) || infoForKind(source.weatherKind);
      decorateWeatherObject(result, info, {
        density: source.weatherDensity,
        spacing: source.weatherSpacing,
        startActive: source.weatherStartActive
      });
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

  function changeWeather(object, kind) {
    const info = infoForKind(kind);
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
    const info = classify(object.particleResource) || infoForKind(object.weatherKind);
    const badge = host.querySelector('.type-badge');
    if (badge) badge.textContent = 'weather zone';

    const section = document.createElement('div');
    section.className = 'property-section eph-weather-volume-v27';
    section.innerHTML = `
      <div class="property-section-title">Weather Zone</div>
      <div class="field-row"><label>Weather</label><select id="ephWeatherTypeV27" class="prop-select"><option value="rain" ${info.kind === 'rain' ? 'selected' : ''}>Rain</option><option value="snow" ${info.kind === 'snow' ? 'selected' : ''}>Snow</option></select></div>
      <div class="field-row"><label>Particle</label><input class="prop-input" value="${esc(info.path)}" readonly></div>
      <div class="field-row"><label>Density</label><input id="ephWeatherDensityV27" class="prop-input" type="number" min="0" max="100" step="1" value="${Math.round(clamp(object.weatherDensity ?? 70, 0, 100))}"></div>
      <label class="toggle-row"><span>Start active</span><input id="ephWeatherStartV27" type="checkbox" ${object.weatherStartActive === false ? '' : 'checked'}></label>
      <div class="selection-info">This scaled box is the real CS2 precipitation volume. EasyPeasyHammer exports one native func_precipitation using subclass <code>${esc(info.subclass)}</code>; CS2's precipitation data selects ${esc(info.path)} and applies the matching atmospheric weather modifier to players inside the volume.</div>`;
    host.appendChild(section);

    section.querySelector('#ephWeatherTypeV27').onchange = event => changeWeather(object, event.target.value);
    section.querySelector('#ephWeatherDensityV27').onchange = event => {
      pushHistory?.();
      object.weatherDensity = String(clamp(event.target.value, 0, 100));
      markDirty?.(`Changed ${info.label.toLowerCase()} density`);
      renderProperties?.();
    };
    section.querySelector('#ephWeatherStartV27').onchange = event => {
      pushHistory?.();
      object.weatherStartActive = Boolean(event.target.checked);
      markDirty?.(`Changed ${info.label.toLowerCase()} start active`);
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
      const info = classify(object.particleResource) || infoForKind(object.weatherKind);
      decorateWeatherObject(object, info);
    }
    queueMicrotask(enhanceProperties);
  }

  install();
  window.addEventListener('eph-runtime-ready', install, { once: true });
  window.EPH_WEATHER_VOLUME = { classify, add, isWeatherPath: path => Boolean(classify(path)) };
  console.info('[Weather Volume V27] Native CS2 func_precipitation rain/snow volumes enabled with correct precipitation subclasses.');
})();
