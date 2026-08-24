// byanca
(() => {
  'use strict';
  if (window.__ephWeatherVolumeV27) return;
  window.__ephWeatherVolumeV27 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const TOOL_MATERIAL = 'materials/tools/toolstrigger.vmat';
  const ZONE_PREFIX = 'EPH_WEATHER_ZONE_';
  const FX_PREFIX = 'EPH_WEATHER_FX_';
  const MAP_PARAMS_NAME = 'EPH_WEATHER_MAP_PARAMS';
  const MAX_EMITTERS = 128;
  const WEATHER = new Map([
    ['particles/rain_fx/rain.vpcf', { label: 'Rain', kind: 'rain' }],
    ['particles/rain_fx/snow.vpcf', { label: 'Snow', kind: 'snow' }]
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
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function normalizedPath(value) {
    let path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (path.toLowerCase().endsWith('_c')) path = path.slice(0, -2);
    if (path && !path.toLowerCase().endsWith('.vpcf')) path += '.vpcf';
    return path;
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
    const match = String(name || '').match(/^EPH_WEATHER_ZONE_(rain|snow)_d(\d+)_s(\d+)_a([01])(?:_|$)/i);
    if (!match) return null;
    return {
      kind: match[1].toLowerCase(),
      density: String(clamp(match[2], 0, 100)),
      spacing: String(clamp(match[3], 64, 2048)),
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
    toast?.(`${info.label} zone added — scale the box to choose where ${info.label.toLowerCase()} is generated`);
    return object;
  }

  function zoneRecords(doc) {
    const zones = [];
    const generatedIds = new Set();
    const legacy = [];

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
      if (targetname.startsWith(FX_PREFIX) || targetname === MAP_PARAMS_NAME) generatedIds.add(elementId(element));
      if (className === 'func_precipitation') {
        const precipType = String(getProp(props, 'preciptype', '0')) === '1' ? 'snow' : 'rain';
        const children = field(element, 'children')?.value;
        const mesh = Array.isArray(children) ? children.find(child => child?.className === 'CMapMesh') : null;
        if (mesh) legacy.push({
          wrapperId: elementId(element),
          meshId: elementId(mesh),
          kind: precipType,
          density: String(clamp(getProp(props, 'renderamt', '70'), 0, 100)),
          spacing: '192',
          startActive: true,
          name: targetname
        });
      }
    });

    return { zones, generatedIds, legacy };
  }

  function collapseWeatherOnExtract(doc, extracted) {
    if (!Array.isArray(extracted)) return extracted;
    const records = zoneRecords(doc);
    const byDmx = new Map(extracted.filter(object => object?.dmxId).map(object => [String(object.dmxId), object]));
    const removeIds = new Set();

    for (const record of records.zones) {
      const object = byDmx.get(record.dmxId);
      if (!object) continue;
      const info = record.kind === 'snow'
        ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
        : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' };
      decorateWeatherObject(object, info, record);
      object.name = nextWeatherName(info.label);
    }

    for (const record of records.legacy) {
      const mesh = byDmx.get(record.meshId);
      const wrapper = byDmx.get(record.wrapperId);
      if (!mesh) continue;
      const info = record.kind === 'snow'
        ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
        : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' };
      decorateWeatherObject(mesh, info, record);
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

  function removeGeneratedEntities(out) {
    const ids = [];
    for (const top of out?.elements || []) walk(top, element => {
      if (element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      const targetname = String(getProp(props, 'targetname', ''));
      const className = lower(getProp(props, 'classname'));
      if (targetname.startsWith(FX_PREFIX) || targetname === MAP_PARAMS_NAME || className === 'func_precipitation') ids.push(elementId(element));
    });
    for (const id of ids) detachByDmxId(out, id);
  }

  function markZoneEditorOnly(out, object, info) {
    const element = VMAP.findElementByDmxId?.(out, object.dmxId);
    if (!element || element.className !== 'CMapMesh') return;
    setField(element, 'editorOnly', 'bool', '1');
    setField(element, 'physicsType', 'string', 'none');
    const meshData = field(element, 'meshData')?.value;
    if (meshData?.fields) setField(meshData, 'name', 'string', markerName(object, info));
  }

  function ensureRainMapParameters(out, density = 70) {
    const added = VMAP.addEntity(out, {
      className: 'info_map_parameters',
      name: MAP_PARAMS_NAME,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      entityProperties: {
        raintracetoskyenabled: '1',
        envrainstrength: String(clamp(density, 0, 100) / 100),
        envpuddleripplestrength: '1'
      }
    });
    return added;
  }

  function rotateLocal(local, angles) {
    const pitch = finite(angles?.[0]) * Math.PI / 180;
    const yaw = finite(angles?.[1]) * Math.PI / 180;
    const roll = finite(angles?.[2]) * Math.PI / 180;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);

    const x1 = local[0];
    const y1 = local[1] * cr - local[2] * sr;
    const z1 = local[1] * sr + local[2] * cr;
    const x2 = x1 * cp + z1 * sp;
    const y2 = y1;
    const z2 = -x1 * sp + z1 * cp;
    return [x2 * cy - y2 * sy, x2 * sy + y2 * cy, z2];
  }

  function localToWorld(object, point, center) {
    const scale = Array.isArray(object.scale) ? object.scale.map(value => finite(value, 1)) : [1, 1, 1];
    const scaled = point.map((value, axis) => center[axis] + (value - center[axis]) * scale[axis]);
    const rotated = rotateLocal(scaled, object.rotation || [0, 0, 0]);
    const position = Array.isArray(object.position) ? object.position.map(value => finite(value)) : [0, 0, 0];
    return rotated.map((value, axis) => value + position[axis]);
  }

  function axisCells(min, max, spacing) {
    const size = Math.max(0.001, max - min);
    const count = Math.max(1, Math.ceil(size / Math.max(1, spacing)));
    const step = size / count;
    return Array.from({ length: count }, (_, index) => min + step * (index + 0.5));
  }

  function emitterPlan(object) {
    const bounds = VMAP.geometryBounds?.(object.vertices || []) || { min: [-256, -256, -128], max: [256, 256, 128], center: [0, 0, 0], size: [512, 512, 256] };
    const density = clamp(object.weatherDensity ?? 70, 0, 100);
    if (density <= 0) return { positions: [], spacing: clamp(object.weatherSpacing ?? 192, 64, 2048), bounds };

    const requestedSpacing = clamp(object.weatherSpacing ?? 192, 64, 2048);
    let spacing = requestedSpacing * Math.sqrt(100 / Math.max(1, density));
    let xs, ys, layers, total;
    do {
      xs = axisCells(bounds.min[0], bounds.max[0], spacing);
      ys = axisCells(bounds.min[1], bounds.max[1], spacing);
      layers = Math.max(1, Math.min(3, Math.ceil(bounds.size[2] / Math.max(384, spacing * 1.5))));
      total = xs.length * ys.length * layers;
      if (total > MAX_EMITTERS) spacing *= 1.18;
    } while (total > MAX_EMITTERS);

    const positions = [];
    const zStep = bounds.size[2] / layers;
    for (let layer = 0; layer < layers; layer++) {
      const z = bounds.max[2] - zStep * (layer + 0.12);
      for (const x of xs) for (const y of ys) positions.push(localToWorld(object, [x, y, z], bounds.center));
    }
    return { positions, spacing, bounds };
  }

  function addParticleEmitter(out, object, info, position, index) {
    const owner = String(object.dmxId || '').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'zone';
    VMAP.addEntity(out, {
      className: 'info_particle_system',
      name: `${FX_PREFIX}${owner}_${String(index + 1).padStart(3, '0')}`,
      position,
      rotation: Array.isArray(object.rotation) ? [...object.rotation] : [0, 0, 0],
      scale: [1, 1, 1],
      entityProperties: {
        effect_name: info.path,
        start_active: object.weatherStartActive === false ? '0' : '1'
      }
    });
  }

  function exportWeather(out, objects) {
    removeGeneratedEntities(out);
    let strongestRain = null;

    for (const object of objects || []) {
      if (!object?.ephWeatherVolume || !object?.dmxId) continue;
      const info = classify(object.particleResource)
        || (object.weatherKind === 'snow'
          ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
          : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' });

      markZoneEditorOnly(out, object, info);
      addMapAssetReference(out, info.path);
      const plan = emitterPlan(object);
      plan.positions.forEach((position, index) => addParticleEmitter(out, object, info, position, index));

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
      const info = classify(source.particleResource)
        || (source.weatherKind === 'snow'
          ? { label: 'Snow', kind: 'snow', path: 'particles/rain_fx/snow.vpcf' }
          : { label: 'Rain', kind: 'rain', path: 'particles/rain_fx/rain.vpcf' });
      decorateWeatherObject(result, info, {
        density: source.weatherDensity,
        spacing: source.weatherSpacing,
        startActive: source.weatherStartActive
      });
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
    const plan = emitterPlan(object);
    const badge = host.querySelector('.type-badge');
    if (badge) badge.textContent = 'weather zone';

    const section = document.createElement('div');
    section.className = 'property-section eph-weather-volume-v27';
    section.innerHTML = `
      <div class="property-section-title">Weather Zone</div>
      <div class="field-row"><label>Weather</label><select id="ephWeatherTypeV27" class="prop-select"><option value="rain" ${info.kind === 'rain' ? 'selected' : ''}>Rain</option><option value="snow" ${info.kind === 'snow' ? 'selected' : ''}>Snow</option></select></div>
      <div class="field-row"><label>Particle</label><input class="prop-input" value="${esc(info.path)}" readonly></div>
      <div class="field-row"><label>Density</label><input id="ephWeatherDensityV27" class="prop-input" type="number" min="0" max="100" step="1" value="${Math.round(clamp(object.weatherDensity ?? 70, 0, 100))}"></div>
      <div class="field-row"><label>Coverage spacing</label><input id="ephWeatherSpacingV27" class="prop-input" type="number" min="64" max="2048" step="16" value="${Math.round(clamp(object.weatherSpacing ?? 192, 64, 2048))}"></div>
      <label class="toggle-row"><span>Start active</span><input id="ephWeatherStartV27" type="checkbox" ${object.weatherStartActive === false ? '' : 'checked'}></label>
      <div class="selection-info">The scaled box is the EasyPeasyHammer weather zone. Saving generates ${plan.positions.length} hidden-in-EPH info_particle_system emitter${plan.positions.length === 1 ? '' : 's'} throughout this zone in Hammer. Move, rotate and scale this one box to control the generated weather area.</div>`;
    host.appendChild(section);

    section.querySelector('#ephWeatherTypeV27').onchange = event => changeWeather(object, event.target.value);
    section.querySelector('#ephWeatherDensityV27').onchange = event => {
      pushHistory?.();
      object.weatherDensity = String(clamp(event.target.value, 0, 100));
      markDirty?.(`Changed ${info.label.toLowerCase()} density`);
      renderProperties?.();
    };
    section.querySelector('#ephWeatherSpacingV27').onchange = event => {
      pushHistory?.();
      object.weatherSpacing = String(clamp(event.target.value, 64, 2048));
      markDirty?.(`Changed ${info.label.toLowerCase()} coverage spacing`);
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
  window.EPH_WEATHER_VOLUME = {
    classify,
    add,
    isWeatherPath: path => Boolean(classify(path)),
    emitterPlan
  };
  console.info('[Weather Volume V27] Scaled rain/snow zones now export distributed CS2 info_particle_system emitters.');
})();
