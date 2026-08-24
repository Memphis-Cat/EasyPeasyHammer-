// byanca
(() => {
  'use strict';
  if (window.__ephCs2WeatherRuntimeV28) return;
  window.__ephCs2WeatherRuntimeV28 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const RAIN = 'particles/rain_fx/rain.vpcf';
  const SNOW = 'particles/rain_fx/snow.vpcf';
  const EMITTER_SPACING = 384;
  const MAX_EMITTERS = 64;
  let wrappedPrepare = null;
  let wrappedExtract = null;
  let wrappedProperties = null;

  const lower = value => String(value || '').replace(/\\/g, '/').trim().toLowerCase();
  const field = (element, key) => element?.fields?.find(item => item?.key === key) || null;
  const scalar = (element, key, fallback = '') => field(element, key)?.value ?? fallback;
  const propsElement = element => {
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

  function walk(element, callback) {
    if (!element?.kind) return;
    callback(element);
    for (const item of element.fields || []) {
      if (Array.isArray(item.value)) item.value.forEach(child => child?.kind && walk(child, callback));
      else if (item.value?.kind) walk(item.value, callback);
    }
  }

  function allElements(doc, callback) {
    for (const element of doc?.elements || []) walk(element, callback);
  }

  function weatherPath(object) {
    const path = lower(object?.particleResource);
    if (path === lower(SNOW) || String(object?.weatherPrecipType) === '1' || String(object?.weatherPrecipType) === '9') return SNOW;
    return RAIN;
  }

  function isWeatherObject(object) {
    return Boolean(object?.ephWeatherVolume && object?.dmxId);
  }

  function precipitationRecords(doc) {
    const records = [];
    allElements(doc, element => {
      if (element?.className !== 'CMapEntity') return;
      const props = propsElement(element);
      if (lower(getProp(props, 'classname')) !== 'func_precipitation') return;
      const children = field(element, 'children')?.value;
      const mesh = Array.isArray(children) ? children.find(child => child?.className === 'CMapMesh') : null;
      records.push({
        wrapperDmxId: String(scalar(element, 'id', '')),
        meshDmxId: String(scalar(mesh, 'id', '')),
        targetname: String(getProp(props, 'targetname', '')),
        preciptype: String(getProp(props, 'preciptype', '')),
      });
    });
    return records;
  }

  function fixImportedWeather(doc, list) {
    const records = precipitationRecords(doc);
    if (!records.length || !Array.isArray(list)) return list;
    for (const record of records) {
      const object = list.find(item => item?.ephWeatherVolume && (
        String(item.ephWeatherWrapperDmxId || '') === record.wrapperDmxId
        || String(item.dmxId || '') === record.meshDmxId
        || (record.targetname && String(item.name || '') === record.targetname)
      ));
      if (!object) continue;
      const snow = record.preciptype === '1' || record.preciptype === '9';
      object.weatherPrecipType = snow ? '1' : '0';
      object.particleResource = snow ? SNOW : RAIN;
      object.blockPlayers = false;
      object.blockGrenades = false;
      object.blockBullets = false;
      object.ephCs2WeatherEmitterVolume = true;
    }
    return list;
  }

  function removeGeneratedPrecipitation(doc, names) {
    let removed = 0;
    const visit = element => {
      if (!element?.kind) return;
      for (const item of element.fields || []) {
        if (!Array.isArray(item.value)) {
          if (item.value?.kind) visit(item.value);
          continue;
        }
        for (let index = item.value.length - 1; index >= 0; index--) {
          const child = item.value[index];
          if (!child?.kind) continue;
          if (child.className === 'CMapEntity') {
            const props = propsElement(child);
            const className = lower(getProp(props, 'classname'));
            const targetname = String(getProp(props, 'targetname', ''));
            if (className === 'func_precipitation' && (!names.size || names.has(targetname))) {
              item.value.splice(index, 1);
              removed++;
              continue;
            }
          }
          visit(child);
        }
      }
    };
    for (const top of doc?.elements || []) visit(top);
    return removed;
  }

  function geometryBounds(object) {
    const vertices = Array.isArray(object?.vertices) ? object.vertices : [];
    if (vertices.length) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const vertex of vertices) {
        for (let axis = 0; axis < 3; axis++) {
          const value = Number(vertex?.[axis]) || 0;
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      return { min, max };
    }
    const size = Array.isArray(object?.size) ? object.size.map(value => Math.max(1, Number(value) || 1)) : [512, 512, 256];
    return { min: size.map(value => -value / 2), max: size.map(value => value / 2) };
  }

  function rotateXYZ(point, rotation) {
    const rx = (Number(rotation?.[0]) || 0) * Math.PI / 180;
    const ry = (Number(rotation?.[1]) || 0) * Math.PI / 180;
    const rz = (Number(rotation?.[2]) || 0) * Math.PI / 180;
    let [x, y, z] = point;

    let c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry); s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rz); s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  }

  function toWorld(object, local) {
    const scale = Array.isArray(object?.scale) ? object.scale : [1, 1, 1];
    const scaled = local.map((value, axis) => value * (Number(scale[axis]) || 1));
    const rotated = rotateXYZ(scaled, object?.rotation || [0, 0, 0]);
    const position = Array.isArray(object?.position) ? object.position : [0, 0, 0];
    return rotated.map((value, axis) => value + (Number(position[axis]) || 0));
  }

  function emitterPositions(object) {
    const bounds = geometryBounds(object);
    const scale = Array.isArray(object?.scale) ? object.scale.map(value => Math.abs(Number(value) || 1)) : [1, 1, 1];
    const width = Math.max(1, Math.abs(bounds.max[0] - bounds.min[0]) * scale[0]);
    const depth = Math.max(1, Math.abs(bounds.max[1] - bounds.min[1]) * scale[1]);
    let nx = Math.max(1, Math.ceil(width / EMITTER_SPACING));
    let ny = Math.max(1, Math.ceil(depth / EMITTER_SPACING));
    if (nx * ny > MAX_EMITTERS) {
      const factor = Math.sqrt((nx * ny) / MAX_EMITTERS);
      nx = Math.max(1, Math.ceil(nx / factor));
      ny = Math.max(1, Math.ceil(ny / factor));
      while (nx * ny > MAX_EMITTERS && (nx > 1 || ny > 1)) {
        if (nx >= ny && nx > 1) nx--;
        else if (ny > 1) ny--;
      }
    }

    const positions = [];
    const localTop = bounds.max[2];
    for (let iy = 0; iy < ny; iy++) {
      const y = bounds.min[1] + (iy + 0.5) * (bounds.max[1] - bounds.min[1]) / ny;
      for (let ix = 0; ix < nx; ix++) {
        const x = bounds.min[0] + (ix + 0.5) * (bounds.max[0] - bounds.min[0]) / nx;
        positions.push(toWorld(object, [x, y, localTop]));
      }
    }
    return positions;
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

  function ensureRainMapParameters(doc) {
    let props = null;
    allElements(doc, element => {
      if (props || element?.className !== 'CMapEntity') return;
      const candidate = propsElement(element);
      if (lower(getProp(candidate, 'classname')) === 'info_map_parameters') props = candidate;
    });

    if (!props) {
      const object = VMAP.addEntity(doc, {
        className: 'info_map_parameters',
        name: '',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        entityProperties: {
          raintracetoskyenabled: '1',
          envrainstrength: '1',
          envpuddleripplestrength: '1'
        }
      });
      return Boolean(object);
    }

    setProp(props, 'raintracetoskyenabled', '1');
    if (String(getProp(props, 'envrainstrength', '')).trim() === '') setProp(props, 'envrainstrength', '1');
    if (String(getProp(props, 'envpuddleripplestrength', '')).trim() === '') setProp(props, 'envpuddleripplestrength', '1');
    return true;
  }

  function addEmitter(doc, object, resource, position, index) {
    const baseName = String(object?.name || (resource === SNOW ? 'Snow' : 'Rain'));
    return VMAP.addEntity(doc, {
      className: 'info_particle_system',
      name: `${baseName}_fx_${String(index + 1).padStart(2, '0')}`,
      position,
      rotation: Array.isArray(object?.rotation) ? [...object.rotation] : [0, 0, 0],
      scale: [1, 1, 1],
      entityProperties: {
        effect_name: resource,
        start_active: '1',
        clientSideEntity: '0'
      }
    });
  }

  function exportCs2Weather(doc, list) {
    const weather = (list || []).filter(isWeatherObject);
    if (!weather.length) return doc;

    const names = new Set(weather.map(object => String(object.name || '')).filter(Boolean));
    const removed = removeGeneratedPrecipitation(doc, names);
    let rainEmitters = 0;
    let snowEmitters = 0;

    for (const object of weather) {
      object.blockPlayers = false;
      object.blockGrenades = false;
      object.blockBullets = false;
      object.ephCs2WeatherEmitterVolume = true;
      const resource = weatherPath(object);
      const positions = emitterPositions(object);
      positions.forEach((position, index) => addEmitter(doc, object, resource, position, index));
      addMapAssetReference(doc, resource);
      if (resource === SNOW) snowEmitters += positions.length;
      else rainEmitters += positions.length;
    }

    if (rainEmitters) ensureRainMapParameters(doc);
    console.info('[CS2 Weather V28] Replaced unsupported func_precipitation export with CS2 info_particle_system emitters.', {
      weatherVolumes: weather.length,
      removedFuncPrecipitation: removed,
      rainEmitters,
      snowEmitters,
      spacing: EMITTER_SPACING,
    });
    return doc;
  }

  function installExtract() {
    const current = VMAP.extractObjects;
    if (typeof current !== 'function') return false;
    if (current.__ephCs2WeatherRuntimeV28) {
      wrappedExtract = current;
      return true;
    }
    if (!current.__ephWeatherVolumeV27 && !window.EPH_WEATHER_VOLUME) return false;
    const previous = current.bind(VMAP);
    const wrapped = function(doc) {
      const list = previous(doc);
      return fixImportedWeather(doc, list);
    };
    wrapped.__ephCs2WeatherRuntimeV28 = true;
    wrapped.__ephPrevious = current;
    VMAP.extractObjects = wrapped;
    wrappedExtract = wrapped;
    return true;
  }

  function installPrepare() {
    const current = VMAP.prepareForSave;
    if (typeof current !== 'function') return false;
    if (current.__ephCs2WeatherRuntimeV28) {
      wrappedPrepare = current;
      return true;
    }
    if (!current.__ephWeatherVolumeV27 && !window.EPH_WEATHER_VOLUME) return false;
    const previous = current.bind(VMAP);
    const wrapped = function(doc, list, ...rest) {
      return exportCs2Weather(previous(doc, list, ...rest), list);
    };
    wrapped.__ephCs2WeatherRuntimeV28 = true;
    wrapped.__ephPrevious = current;
    VMAP.prepareForSave = wrapped;
    wrappedPrepare = wrapped;
    return true;
  }

  function enhanceProperties() {
    const object = typeof current === 'function' ? current() : null;
    if (!object?.ephWeatherVolume) return;
    object.ephCs2WeatherEmitterVolume = true;
    object.blockPlayers = false;
    object.blockGrenades = false;
    object.blockBullets = false;
    const host = document.getElementById('propertiesContent');
    if (!host) return;
    const section = host.querySelector('.eph-weather-volume-v27');
    if (!section) return;
    const notes = section.querySelectorAll('.selection-info');
    if (notes.length) {
      notes[0].textContent = `CS2 does not use func_precipitation. This EasyPeasyHammer box is an editor volume: on save it becomes supported info_particle_system emitters spread across the box (about one every ${EMITTER_SPACING} units). Move/rotate/scale the box to move the emitter coverage.`;
    }
    if (!section.querySelector('.eph-cs2-weather-v28')) {
      const note = document.createElement('div');
      note.className = 'selection-info eph-cs2-weather-v28';
      note.textContent = 'Rain also enables the CS2 info_map_parameters rain trace-to-sky setting for wet/rain surface effects. The .vpcf still controls each emitter’s exact particle spread.';
      section.appendChild(note);
    }
  }

  function installProperties() {
    if (typeof renderProperties !== 'function') return false;
    if (renderProperties.__ephCs2WeatherRuntimeV28) {
      wrappedProperties = renderProperties;
      queueMicrotask(enhanceProperties);
      return true;
    }
    const previous = renderProperties;
    const wrapped = function(...args) {
      const result = previous(...args);
      queueMicrotask(enhanceProperties);
      return result;
    };
    for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
    wrapped.__ephCs2WeatherRuntimeV28 = true;
    wrapped.__ephPrevious = previous;
    renderProperties = wrapped;
    window.renderProperties = wrapped;
    wrappedProperties = wrapped;
    return true;
  }

  function decorateExisting() {
    for (const object of S?.objects || []) {
      if (!object?.ephWeatherVolume) continue;
      object.ephCs2WeatherEmitterVolume = true;
      object.blockPlayers = false;
      object.blockGrenades = false;
      object.blockBullets = false;
    }
  }

  function install() {
    if (!window.EPH_WEATHER_VOLUME) return false;
    installExtract();
    installPrepare();
    installProperties();
    decorateExisting();
    queueMicrotask(enhanceProperties);
    return Boolean(wrappedPrepare && wrappedExtract);
  }

  install();
  window.addEventListener('eph-runtime-ready', install, { once: true });
  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    install();
    if (checks >= 60 || (wrappedPrepare && wrappedExtract && wrappedProperties)) clearInterval(guard);
  }, 100);

  window.EPH_CS2_WEATHER_V28 = {
    export: exportCs2Weather,
    emitterPositions,
    spacing: EMITTER_SPACING,
    maxEmitters: MAX_EMITTERS,
  };
})();
