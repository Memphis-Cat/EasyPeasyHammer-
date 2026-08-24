// byanca
(() => {
  'use strict';
  if (window.__ephWeatherVolumeV29) return;
  window.__ephWeatherVolumeV29 = true;
  window.__ephWeatherVolumeV27 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const TOOL_MATERIAL = 'materials/tools/toolsprecipitation.vmat';
  const ZONE_PREFIX = 'EPH_WEATHER_ZONE_';
  const FX_PREFIX = 'EPH_WEATHER_FX_';
  const CP_PREFIX = 'EPH_WEATHER_CP_';
  const MAP_PARAMS_NAME = 'EPH_WEATHER_MAP_PARAMS';
  const MAX_EMITTERS = 64;

  // Asset Manager still exposes Valve's logical weather assets. For runtime we
  // deliberately use the stock particle that is actually suitable for a point
  // info_particle_system. rain.vpcf expects CP1; rain_single_800.vpcf does not.
  const WEATHER = new Map([
    ['particles/rain_fx/rain.vpcf', {
      label: 'Rain', kind: 'rain', logicalPath: 'particles/rain_fx/rain.vpcf',
      runtimePath: 'particles/rain_fx/rain_single_800.vpcf', defaultSpacing: 650,
      requiresControlPoint1: false
    }],
    ['particles/rain_fx/snow.vpcf', {
      label: 'Snow', kind: 'snow', logicalPath: 'particles/rain_fx/snow.vpcf',
      runtimePath: 'particles/rain_fx/snow.vpcf', defaultSpacing: 500,
      requiresControlPoint1: true
    }]
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

  function walk(element, callback) {
    if (!element?.kind) return;
    callback(element);
    for (const item of element.fields || []) {
      if (Array.isArray(item.value)) item.value.forEach(child => child?.kind && walk(child, callback));
      else if (item.value?.kind) walk(item.value, callback);
    }
  }

  function normalizedPath(value) {
    let path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (path.toLowerCase().endsWith('_c')) path = path.slice(0, -2);
    if (path && !path.toLowerCase().endsWith('.vpcf')) path += '.vpcf';
    return path;
  }

  function infoForKind(kind) {
    return String(kind || '').toLowerCase() === 'snow'
      ? { ...WEATHER.get('particles/rain_fx/snow.vpcf') }
      : { ...WEATHER.get('particles/rain_fx/rain.vpcf') };
  }

  function classify(path) {
    const normalized = normalizedPath(path);
    const direct = WEATHER.get(lower(normalized));
    if (direct) return { ...direct };
    // Re-open maps saved by this pass even when the runtime rain asset is the
    // standalone rain_single_800 particle rather than the logical rain asset.
    if (lower(normalized) === 'particles/rain_fx/rain_single_800.vpcf') return infoForKind('rain');
    return null;
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

  function markerSettings(name) {
    const value = String(name || '');
    let match = value.match(/^EPH_WEATHER_ZONE_V29_(rain|snow)_d(\d+)_s(\d+)_a([01])(?:_|$)/i);
    if (match) return {
      kind: match[1].toLowerCase(), density: String(clamp(match[2], 0, 100)),
      spacing: String(clamp(match[3], 96, 2048)), startActive: match[4] !== '0', legacy: false
    };
    match = value.match(/^EPH_WEATHER_ZONE_(rain|snow)_d(\d+)(?:_s(\d+))?_a([01])(?:_|$)/i);
    if (!match) return null;
    const info = infoForKind(match[1]);
    const oldSpacing = finite(match[3], 192);
    return {
      kind: match[1].toLowerCase(), density: String(clamp(match[2], 0, 100)),
      // 192 was the old experimental default that produced far too many
      // entities. Migrate that exact default to the researched runtime spacing.
      spacing: String(Math.abs(oldSpacing - 192) < 0.01 ? info.defaultSpacing : clamp(oldSpacing, 96, 2048)),
      startActive: match[4] !== '0', legacy: true
    };
  }

  function markerName(object, info) {
    const density = Math.round(clamp(object.weatherDensity ?? 70, 0, 100));
    const spacing = Math.round(clamp(object.weatherSpacing ?? info.defaultSpacing, 96, 2048));
    const active = object.weatherStartActive === false ? 0 : 1;
    const suffix = String(object.dmxId || '').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'zone';
    return `${ZONE_PREFIX}V29_${info.kind}_d${density}_s${spacing}_a${active}_${suffix}`;
  }

  function decorateWeatherObject(object, info, extras = {}) {
    if (!object || !info) return object;
    object.ephWeatherVolume = true;
    object.particleResource = info.logicalPath;
    object.weatherKind = info.kind;
    object.weatherDensity = String(clamp(extras.density ?? object.weatherDensity ?? 70, 0, 100));
    object.weatherSpacing = String(clamp(extras.spacing ?? object.weatherSpacing ?? info.defaultSpacing, 96, 2048));
    object.weatherStartActive = extras.startActive ?? object.weatherStartActive ?? true;
    if (extras.wrapperDmxId) object.ephWeatherWrapperDmxId = String(extras.wrapperDmxId);
    else delete object.ephWeatherWrapperDmxId;
    object.collision = false;
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
      size: [512, 512, 768],
      position: [0, 0, 384],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      collision: false,
      materials,
      material: TOOL_MATERIAL,
      meshName: `${ZONE_PREFIX}V29_${info.kind}_d70_s${info.defaultSpacing}_a1_new`
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
    toast?.(`${info.label} zone added — scale the box to set weather coverage`);
    return object;
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

  function meshMarker(mesh) {
    if (mesh?.className !== 'CMapMesh') return '';
    return String(scalar(field(mesh, 'meshData')?.value, 'name', ''));
  }

  function generatedTargetName(targetname) {
    const name = String(targetname || '');
    return name.startsWith(FX_PREFIX)
      || name.startsWith(CP_PREFIX)
      || /^(?:rain|snow)_\d+_fx_\d+$/i.test(name)
      || /^(?:rain|snow)_\d+_cp_\d+$/i.test(name);
  }

  function weatherRecords(doc) {
    const zones = [];
    const generatedIds = new Set();
    const legacyWrappers = [];
    for (const top of doc?.elements || []) walk(top, element => {
      if (element.className === 'CMapMesh') {
        const settings = markerSettings(meshMarker(element));
        if (settings) zones.push({ dmxId: elementId(element), ...settings });
        return;
      }
      if (element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      const className = lower(getProp(props, 'classname'));
      const targetname = String(getProp(props, 'targetname', ''));
      if (generatedTargetName(targetname) || targetname === MAP_PARAMS_NAME) generatedIds.add(elementId(element));
      if (className !== 'func_precipitation') return;
      const children = field(element, 'children')?.value;
      const mesh = Array.isArray(children) ? children.find(child => child?.className === 'CMapMesh') : null;
      const marker = meshMarker(mesh);
      const marked = markerSettings(marker);
      const oursByName = /^(?:Rain|Snow)_\d+$/i.test(targetname);
      if (!mesh || (!marked && !oursByName)) return;
      const subclass = lower(getProp(props, 'subclass_name', ''));
      const preciptype = String(getProp(props, 'preciptype', ''));
      const kind = marked?.kind || (subclass.includes('snow') || preciptype === '9' || preciptype === '1' || /^Snow_/i.test(targetname) ? 'snow' : 'rain');
      const info = infoForKind(kind);
      legacyWrappers.push({
        wrapperDmxId: elementId(element), meshDmxId: elementId(mesh), kind,
        density: String(clamp(marked?.density ?? getProp(props, 'renderamt', '70'), 0, 100)),
        spacing: String(clamp(marked?.spacing ?? info.defaultSpacing, 96, 2048)),
        startActive: marked?.startActive ?? (String(getProp(props, 'StartDisabled', '0')) !== '1'),
        name: targetname
      });
    });
    return { zones, generatedIds, legacyWrappers };
  }

  function collapseWeatherOnExtract(doc, extracted) {
    if (!Array.isArray(extracted)) return extracted;
    const records = weatherRecords(doc);
    const byDmx = new Map(extracted.filter(object => object?.dmxId).map(object => [String(object.dmxId), object]));
    const removeIds = new Set();
    let rainIndex = 0;
    let snowIndex = 0;

    for (const record of records.zones) {
      const object = byDmx.get(record.dmxId);
      if (!object) continue;
      const info = infoForKind(record.kind);
      decorateWeatherObject(object, info, record);
      const index = info.kind === 'snow' ? ++snowIndex : ++rainIndex;
      object.name = `${info.label}_${String(index).padStart(3, '0')}`;
    }

    for (const record of records.legacyWrappers) {
      const mesh = byDmx.get(record.meshDmxId);
      const wrapper = byDmx.get(record.wrapperDmxId);
      if (!mesh) continue;
      const info = infoForKind(record.kind);
      decorateWeatherObject(mesh, info, { ...record, wrapperDmxId: record.wrapperDmxId });
      mesh.parent = 'world';
      mesh.ephMeshEntityChild = false;
      mesh.name = record.name || `${info.label}_${String(info.kind === 'snow' ? ++snowIndex : ++rainIndex).padStart(3, '0')}`;
      if (wrapper) removeIds.add(wrapper.id);
    }

    for (const id of records.generatedIds) {
      const object = byDmx.get(id);
      if (object) removeIds.add(object.id);
    }
    return extracted.filter(object => !removeIds.has(object.id));
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

  function liftAndRemoveLegacyPrecipitation(out) {
    const wrappers = [];
    for (const top of out?.elements || []) walk(top, element => {
      if (element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      if (lower(getProp(props, 'classname')) !== 'func_precipitation') return;
      const targetname = String(getProp(props, 'targetname', ''));
      const children = field(element, 'children')?.value;
      const mesh = Array.isArray(children) ? children.find(child => child?.className === 'CMapMesh') : null;
      const ours = markerSettings(meshMarker(mesh)) || /^(?:Rain|Snow)_\d+$/i.test(targetname);
      if (ours && mesh) wrappers.push({ wrapperId: elementId(element), meshId: elementId(mesh) });
    });
    const worldChildren = VMAP.getWorldChildren?.(out) || [];
    for (const record of wrappers) {
      const mesh = detachByDmxId(out, record.meshId);
      detachByDmxId(out, record.wrapperId);
      if (mesh && !worldChildren.some(child => elementId(child) === record.meshId)) worldChildren.push(mesh);
    }
  }

  function removeGeneratedWeatherEntities(out, keepMapParameters) {
    const ids = [];
    for (const top of out?.elements || []) walk(top, element => {
      if (element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      const targetname = String(getProp(props, 'targetname', ''));
      if (generatedTargetName(targetname) || (!keepMapParameters && targetname === MAP_PARAMS_NAME)) ids.push(elementId(element));
    });
    for (const id of ids) detachByDmxId(out, id);
  }

  function prepareZoneMarker(out, object, info) {
    const mesh = VMAP.findElementByDmxId?.(out, object.dmxId);
    if (!mesh || mesh.className !== 'CMapMesh') return false;
    setField(mesh, 'editorOnly', 'bool', '1');
    setField(mesh, 'physicsType', 'string', 'none');
    setField(mesh, 'force_hidden', 'bool', object.visible === false ? '1' : '0');
    const meshData = field(mesh, 'meshData')?.value;
    if (meshData?.fields) {
      setField(meshData, 'name', 'string', markerName(object, info));
      const materials = field(meshData, 'materials');
      if (materials) materials.value = [TOOL_MATERIAL];
    }
    return true;
  }

  // Source 2 QAngle: pitch around Y, yaw around Z, roll around X.
  function rotateLocal(point, angles) {
    const pitch = finite(angles?.[0]) * Math.PI / 180;
    const yaw = finite(angles?.[1]) * Math.PI / 180;
    const roll = finite(angles?.[2]) * Math.PI / 180;
    let [x, y, z] = point;
    let c = Math.cos(roll), s = Math.sin(roll);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(pitch); s = Math.sin(pitch);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(yaw); s = Math.sin(yaw);
    [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  }

  function localToWorld(object, local) {
    const scale = Array.isArray(object?.scale) ? object.scale.map(value => finite(value, 1)) : [1, 1, 1];
    const scaled = local.map((value, axis) => value * scale[axis]);
    const rotated = rotateLocal(scaled, object?.rotation || [0, 0, 0]);
    const position = Array.isArray(object?.position) ? object.position.map(value => finite(value)) : [0, 0, 0];
    return rotated.map((value, axis) => value + position[axis]);
  }

  function axisCenters(min, max, count) {
    const size = Math.max(0.001, max - min);
    const step = size / Math.max(1, count);
    return Array.from({ length: Math.max(1, count) }, (_, index) => min + step * (index + 0.5));
  }

  function emitterPlan(object, info) {
    const bounds = VMAP.geometryBounds?.(object.vertices || []) || {
      min: [-256, -256, -384], max: [256, 256, 384], center: [0, 0, 0], size: [512, 512, 768]
    };
    const scale = Array.isArray(object?.scale) ? object.scale.map(value => Math.abs(finite(value, 1))) : [1, 1, 1];
    const width = Math.max(1, bounds.size[0] * scale[0]);
    const depth = Math.max(1, bounds.size[1] * scale[1]);
    const density = clamp(object.weatherDensity ?? 70, 0, 100);
    const requested = clamp(object.weatherSpacing ?? info.defaultSpacing, 96, 2048);
    if (density <= 0) return { positions: [], spacing: requested, bounds };

    let spacing = requested * Math.sqrt(100 / Math.max(5, density));
    let nx = Math.max(1, Math.ceil(width / spacing));
    let ny = Math.max(1, Math.ceil(depth / spacing));
    while (nx * ny > MAX_EMITTERS) {
      spacing *= 1.12;
      nx = Math.max(1, Math.ceil(width / spacing));
      ny = Math.max(1, Math.ceil(depth / spacing));
    }

    const xs = axisCenters(bounds.min[0], bounds.max[0], nx);
    const ys = axisCenters(bounds.min[1], bounds.max[1], ny);
    const height = Math.max(1, bounds.size[2]);
    // Spawn near the top of the user-defined volume. Falling particles then
    // travel downward through the zone instead of being spawned at its center.
    const localZ = bounds.max[2] - Math.min(96, height * 0.12);
    const positions = [];
    for (const y of ys) for (const x of xs) positions.push(localToWorld(object, [x, y, localZ]));
    return { positions, spacing, bounds, nx, ny };
  }

  function ownerToken(object) {
    return String(object?.dmxId || object?.id || 'zone').replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'zone';
  }

  function addControlPoint(out, object, position, index) {
    const name = `${CP_PREFIX}${ownerToken(object)}_${String(index + 1).padStart(3, '0')}`;
    VMAP.addEntity(out, {
      className: 'info_target', name, position, rotation: [0, 0, 0], scale: [1, 1, 1],
      entityProperties: {}
    });
    return name;
  }

  function addParticleEmitter(out, object, info, position, index) {
    const cpoint1 = info.requiresControlPoint1 ? addControlPoint(out, object, position, index) : null;
    const entityProperties = {
      effect_name: info.runtimePath,
      start_active: object.weatherStartActive === false ? '0' : '1'
    };
    if (cpoint1) entityProperties.cpoint1 = cpoint1;
    VMAP.addEntity(out, {
      className: 'info_particle_system',
      name: `${FX_PREFIX}${ownerToken(object)}_${String(index + 1).padStart(3, '0')}`,
      position,
      // Weather falls along world -Z. Zone rotation controls where the coverage
      // grid lies; it must not accidentally tilt gravity by rotating each effect.
      rotation: [0, 0, 0], scale: [1, 1, 1], entityProperties
    });
  }

  function mapParameterEntities(out) {
    const result = [];
    for (const top of out?.elements || []) walk(top, element => {
      if (element.className !== 'CMapEntity') return;
      const props = entityPropsElement(element);
      if (lower(getProp(props, 'classname')) === 'info_map_parameters') result.push(element);
    });
    return result;
  }

  function ensureRainMapParameters(out, density) {
    const existing = mapParameterEntities(out);
    let chosen = existing.find(element => String(getProp(entityPropsElement(element), 'targetname', '')) !== MAP_PARAMS_NAME)
      || existing[0] || null;
    if (!chosen) {
      const added = VMAP.addEntity(out, {
        className: 'info_map_parameters', name: MAP_PARAMS_NAME,
        position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], entityProperties: {}
      });
      chosen = VMAP.findElementByDmxId?.(out, added?.dmxId) || null;
    }
    const props = entityPropsElement(chosen);
    if (!props) return;
    setProp(props, 'raintracetoskyenabled', '1');
    setProp(props, 'envrainstrength', String(clamp(density, 0, 100) / 100));
    setProp(props, 'envpuddleripplestrength', '1');
    setProp(props, 'envpuddlerippledirection', '0');
    setProp(props, 'envwetnesscoverage', '1');
    setProp(props, 'envwetnessdryingamount', '0');

    // If a user-owned info_map_parameters already exists, remove only our old
    // duplicate instead of leaving two CMapInfo entities fighting for settings.
    if (String(getProp(props, 'targetname', '')) !== MAP_PARAMS_NAME) {
      for (const element of existing) {
        const ep = entityPropsElement(element);
        if (String(getProp(ep, 'targetname', '')) === MAP_PARAMS_NAME) detachByDmxId(out, elementId(element));
      }
    }
  }

  function exportWeather(out, objects) {
    const weather = (objects || []).filter(object => object?.ephWeatherVolume && object?.dmxId);
    const hasRain = weather.some(object => (classify(object.particleResource) || infoForKind(object.weatherKind)).kind === 'rain');

    // Migrate all versions previously generated by EasyPeasyHammer. The current
    // CS2 FGD excludes func_precipitation, so none of our weather relies on it.
    liftAndRemoveLegacyPrecipitation(out);
    removeGeneratedWeatherEntities(out, hasRain);

    let strongestRain = 0;
    for (const object of weather) {
      const info = classify(object.particleResource) || infoForKind(object.weatherKind);
      decorateWeatherObject(object, info);
      prepareZoneMarker(out, object, info);
      addMapAssetReference(out, info.runtimePath);
      const plan = emitterPlan(object, info);
      plan.positions.forEach((position, index) => addParticleEmitter(out, object, info, position, index));
      if (info.kind === 'rain') strongestRain = Math.max(strongestRain, clamp(object.weatherDensity ?? 70, 0, 100));
      console.info(`[Weather V29] ${object.name || info.label}: ${plan.positions.length} ${info.runtimePath} emitter(s).`, {
        grid: `${plan.nx || 0}x${plan.ny || 0}`, spacing: Number(plan.spacing?.toFixed?.(1) || plan.spacing), rotation: object.rotation
      });
    }
    if (hasRain) ensureRainMapParameters(out, strongestRain || 70);
    return out;
  }

  function installExtract() {
    const current = VMAP.extractObjects;
    if (typeof current !== 'function' || current.__ephWeatherVolumeV29) return;
    const previous = current.bind(VMAP);
    const wrapped = function(doc) { return collapseWeatherOnExtract(doc, previous(doc)); };
    wrapped.__ephWeatherVolumeV29 = true;
    wrapped.__ephWeatherVolumeV27 = true;
    wrapped.__ephPrevious = current;
    VMAP.extractObjects = wrapped;
  }

  function installPrepareForSave() {
    const current = VMAP.prepareForSave;
    if (typeof current !== 'function' || current.__ephWeatherVolumeV29) return;
    const previous = current.bind(VMAP);
    const wrapped = function(doc, objects, ...rest) { return exportWeather(previous(doc, objects, ...rest), objects); };
    wrapped.__ephWeatherVolumeV29 = true;
    wrapped.__ephWeatherVolumeV27 = true;
    wrapped.__ephPrevious = current;
    VMAP.prepareForSave = wrapped;
  }

  function installDuplicate() {
    if (typeof duplicate !== 'function' || duplicate.__ephWeatherVolumeV29) return;
    const previous = duplicate;
    const wrapped = function(...args) {
      const source = current?.();
      const result = previous(...args);
      if (!source?.ephWeatherVolume || !result || result.type !== 'part') return result;
      const info = classify(source.particleResource) || infoForKind(source.weatherKind);
      decorateWeatherObject(result, info, {
        density: source.weatherDensity, spacing: source.weatherSpacing, startActive: source.weatherStartActive
      });
      result.name = nextWeatherName(info.label);
      VMAP.applyObjectToDocument?.(S.doc, result);
      markDirty?.(`Duplicated as ${result.name}`);
      renderTree?.();
      renderProperties?.();
      return result;
    };
    wrapped.__ephWeatherVolumeV29 = true;
    wrapped.__ephPrevious = previous;
    duplicate = wrapped;
    window.duplicate = wrapped;
  }

  function changeWeather(object, kind) {
    const info = infoForKind(kind);
    pushHistory?.();
    object.weatherKind = info.kind;
    object.particleResource = info.logicalPath;
    object.weatherSpacing = String(info.defaultSpacing);
    object.name = nextWeatherName(info.label);
    VMAP.applyObjectToDocument?.(S.doc, object);
    markDirty?.(`Changed weather to ${info.label}`);
    renderTree?.();
    renderProperties?.();
  }

  function enhanceProperties() {
    const object = current?.();
    if (!object?.ephWeatherVolume) return;
    const host = document.getElementById('propertiesContent');
    if (!host || host.querySelector('.eph-weather-volume-v29')) return;
    const info = classify(object.particleResource) || infoForKind(object.weatherKind);
    const plan = emitterPlan(object, info);
    const badge = host.querySelector('.type-badge');
    if (badge) badge.textContent = 'weather zone';

    const section = document.createElement('div');
    section.className = 'property-section eph-weather-volume-v27 eph-weather-volume-v29';
    section.innerHTML = `
      <div class="property-section-title">CS2 Weather Zone</div>
      <div class="field-row"><label>Weather</label><select id="ephWeatherTypeV29" class="prop-select"><option value="rain" ${info.kind === 'rain' ? 'selected' : ''}>Rain</option><option value="snow" ${info.kind === 'snow' ? 'selected' : ''}>Snow</option></select></div>
      <div class="field-row"><label>Asset</label><input class="prop-input" value="${esc(info.logicalPath)}" readonly></div>
      <div class="field-row"><label>Runtime particle</label><input class="prop-input" value="${esc(info.runtimePath)}" readonly></div>
      <div class="field-row"><label>Density</label><input id="ephWeatherDensityV29" class="prop-input" type="number" min="0" max="100" step="1" value="${Math.round(clamp(object.weatherDensity ?? 70, 0, 100))}"></div>
      <div class="field-row"><label>Coverage spacing</label><input id="ephWeatherSpacingV29" class="prop-input" type="number" min="96" max="2048" step="16" value="${Math.round(clamp(object.weatherSpacing ?? info.defaultSpacing, 96, 2048))}"></div>
      <label class="toggle-row"><span>Start active</span><input id="ephWeatherStartV29" type="checkbox" ${object.weatherStartActive === false ? '' : 'checked'}></label>
      <div class="selection-info">Scale/rotate/move this box to define coverage. Saving creates ${plan.positions.length} distributed info_particle_system${plan.positions.length === 1 ? '' : 's'} near the top of the box. ${info.kind === 'snow' ? 'Snow also gets a real CP1 target for every emitter because Valve snow.vpcf reads control point 1.' : 'Rain uses Valve rain_single_800.vpcf because it is a standalone CP0 rain emitter; rain.vpcf itself expects control point 1.'}</div>
      <div class="selection-info">The box is Editor Only and non-colliding in Hammer. env_sky is not modified. Rain additionally enables the official info_map_parameters rain trace-to-sky/wetness settings.</div>`;
    host.appendChild(section);

    section.querySelector('#ephWeatherTypeV29').onchange = event => changeWeather(object, event.target.value);
    section.querySelector('#ephWeatherDensityV29').onchange = event => {
      pushHistory?.();
      object.weatherDensity = String(clamp(event.target.value, 0, 100));
      markDirty?.(`Changed ${info.label.toLowerCase()} density`);
      renderProperties?.();
    };
    section.querySelector('#ephWeatherSpacingV29').onchange = event => {
      pushHistory?.();
      object.weatherSpacing = String(clamp(event.target.value, 96, 2048));
      markDirty?.(`Changed ${info.label.toLowerCase()} coverage spacing`);
      renderProperties?.();
    };
    section.querySelector('#ephWeatherStartV29').onchange = event => {
      pushHistory?.();
      object.weatherStartActive = Boolean(event.target.checked);
      markDirty?.(`Changed ${info.label.toLowerCase()} start active`);
    };
  }

  function installProperties() {
    if (typeof renderProperties !== 'function' || renderProperties.__ephWeatherVolumeV29) return;
    const previous = renderProperties;
    const wrapped = function(...args) {
      const result = previous(...args);
      queueMicrotask(enhanceProperties);
      return result;
    };
    for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
    wrapped.__ephWeatherVolumeV29 = true;
    wrapped.__ephPrevious = previous;
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
      const info = classify(object.particleResource) || infoForKind(object.weatherKind);
      decorateWeatherObject(object, info);
    }
    queueMicrotask(enhanceProperties);
  }

  install();
  window.addEventListener('eph-runtime-ready', install, { once: true });
  window.EPH_WEATHER_VOLUME = {
    version: 29,
    classify,
    add,
    isWeatherPath: path => Boolean(classify(path)),
    emitterPlan
  };
  console.info('[Weather V29] CS2 weather uses researched point particles + CP1 wiring; func_precipitation export disabled.');
})();
