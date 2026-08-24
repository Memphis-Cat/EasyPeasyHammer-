// byanca
(() => {
  'use strict';
  if (window.__ephWeatherAudioV37) return;
  window.__ephWeatherAudioV37 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP) return;

  const PREFIX = 'EPH_RAIN_AUDIO_';
  const EXPOSED_NAME = `${PREFIX}EXPOSED`;
  const SHELTERED_NAME = `${PREFIX}SHELTERED`;
  const EXPOSED_EVENT = 'train.Outside_TSpawn.Rain';
  const SHELTERED_EVENT = 'train.TStairs.Rain';
  const TRIGGER_MATERIAL = 'materials/tools/toolstrigger.vmat';
  const OUTER_MARGIN = [768, 768, 256];
  let installedPrepare = null;

  const field = (element, key) => element?.fields?.find(item => item?.key === key) || null;
  const scalar = (element, key, fallback = '') => field(element, key)?.value ?? fallback;
  const elementId = element => String(scalar(element, 'id', ''));
  const entityProps = element => {
    const value = field(element, 'entity_properties')?.value;
    return value?.kind === 'element' ? value : null;
  };
  const getProp = (props, key, fallback = '') => field(props, key)?.value ?? fallback;
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
  const lower = value => String(value || '').replace(/\\/g, '/').trim().toLowerCase();

  function walk(element, callback) {
    if (!element?.kind) return;
    callback(element);
    for (const item of element.fields || []) {
      if (Array.isArray(item.value)) item.value.forEach(child => child?.kind && walk(child, callback));
      else if (item.value?.kind) walk(item.value, callback);
    }
  }

  function detachByDmxId(doc, dmxId) {
    const wanted = String(dmxId || '');
    const remove = element => {
      if (!element?.kind) return null;
      for (const item of element.fields || []) {
        if (Array.isArray(item.value)) {
          const index = item.value.findIndex(child => child?.kind && elementId(child) === wanted);
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

  function childArray(element) {
    let item = field(element, 'children');
    if (!item) {
      item = { key: 'children', type: 'element_array', value: [] };
      element.fields.push(item);
    }
    if (!Array.isArray(item.value)) item.value = [];
    return item.value;
  }

  function removeGenerated(out) {
    const ids = [];
    for (const top of out?.elements || []) walk(top, element => {
      if (element.className !== 'CMapEntity') return;
      const targetname = String(getProp(entityProps(element), 'targetname', ''));
      if (targetname.startsWith(PREFIX)) ids.push(elementId(element));
    });
    for (const id of ids) detachByDmxId(out, id);
  }

  function isRainZone(object) {
    if (!object?.ephWeatherVolume) return false;
    if (String(object.weatherKind || '').toLowerCase() === 'rain') return true;
    return lower(object.particleResource) === 'particles/rain_fx/rain.vpcf';
  }

  function boundsFor(object) {
    return VMAP.geometryBounds?.(object?.vertices || []) || {
      min: [-256, -256, -128], max: [256, 256, 128], center: [0, 0, 0], size: [512, 512, 256]
    };
  }

  function expandedVertices(object, margin = [0, 0, 0]) {
    const vertices = Array.isArray(object?.vertices) && object.vertices.length
      ? object.vertices.map(vertex => [...vertex])
      : null;
    if (!vertices) return null;
    const bounds = boundsFor(object);
    const scale = Array.isArray(object.scale) ? object.scale.map(value => Math.max(0.0001, Math.abs(Number(value) || 1))) : [1, 1, 1];
    const factors = [0, 1, 2].map(axis => {
      const localMargin = Math.max(0, Number(margin[axis]) || 0) / scale[axis];
      const size = Math.max(0.0001, Number(bounds.size[axis]) || 1);
      return (size + localMargin * 2) / size;
    });
    return vertices.map(vertex => vertex.map((value, axis) => bounds.center[axis] + (value - bounds.center[axis]) * factors[axis]));
  }

  function addSoundscape(out, name, soundEvent) {
    return VMAP.addEntity(out, {
      className: 'snd_soundscape_triggerable',
      name,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      entityProperties: {
        StartDisabled: '0',
        radius: '0',
        enablesoundevent: '1',
        soundevent: soundEvent
      }
    });
  }

  function addTrigger(out, object, name, soundscapeName, margin) {
    const vertices = expandedVertices(object, margin);
    const faceCount = Array.isArray(object.faces) && object.faces.length ? object.faces.length : 6;
    const meshObject = VMAP.addPart(out, {
      vertices: vertices || undefined,
      faces: Array.isArray(object.faces) && object.faces.length ? object.faces.map(face => [...face]) : undefined,
      size: Array.isArray(object.size) ? [...object.size] : [512, 512, 256],
      position: Array.isArray(object.position) ? [...object.position] : [0, 0, 0],
      rotation: Array.isArray(object.rotation) ? [...object.rotation] : [0, 0, 0],
      scale: Array.isArray(object.scale) ? [...object.scale] : [1, 1, 1],
      collision: true,
      visible: true,
      meshName: `${name}_MESH`,
      material: TRIGGER_MATERIAL,
      faceMaterials: Array.from({ length: faceCount }, () => TRIGGER_MATERIAL)
    });
    if (!meshObject?.dmxId) return null;
    const mesh = detachByDmxId(out, meshObject.dmxId);
    if (!mesh) return null;

    // Trigger geometry must participate in trigger touches, but it is not a
    // physical blocking prop/brush. The trigger entity owns its behavior.
    setField(mesh, 'editorOnly', 'bool', '0');
    setField(mesh, 'physicsType', 'string', 'default');
    setField(mesh, 'force_hidden', 'bool', '0');

    const triggerObject = VMAP.addEntity(out, {
      className: 'trigger_soundscape',
      name,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      entityProperties: {
        soundscape: soundscapeName,
        spawnflags: '1',
        StartDisabled: '0'
      }
    });
    const trigger = VMAP.findElementByDmxId?.(out, triggerObject?.dmxId);
    if (!trigger) return null;
    childArray(trigger).push(mesh);
    return triggerObject;
  }

  function addAutomaticRainAudio(out, objects) {
    removeGenerated(out);
    const zones = (objects || []).filter(isRainZone).filter(object => object.weatherStartActive !== false);
    if (!zones.length) return out;

    // Valve's current de_train soundevents provide separate exposed and
    // sheltered rain loops. Soundscape triggers are client-specific, so each
    // player gets the correct transition without map I/O or server plugins.
    addSoundscape(out, SHELTERED_NAME, SHELTERED_EVENT);
    addSoundscape(out, EXPOSED_NAME, EXPOSED_EVENT);

    zones.forEach((zone, index) => {
      const suffix = String(index + 1).padStart(3, '0');
      // The larger trigger is entered first and supplies the muffled/sheltered
      // rain loop. The exact weather volume is added second and takes priority
      // while the player is actually inside the exposed rain zone. Leaving the
      // inner zone naturally falls back to the still-active outer soundscape.
      addTrigger(out, zone, `${PREFIX}SHELTER_${suffix}`, SHELTERED_NAME, OUTER_MARGIN);
      addTrigger(out, zone, `${PREFIX}EXPOSED_${suffix}`, EXPOSED_NAME, [0, 0, 0]);
    });
    return out;
  }

  function installPrepare() {
    const current = VMAP.prepareForSave;
    if (typeof current !== 'function' || current.__ephWeatherAudioV37) {
      if (current?.__ephWeatherAudioV37) installedPrepare = current;
      return false;
    }
    const previous = current.bind(VMAP);
    const wrapped = function(doc, objects, ...rest) {
      const prepared = previous(doc, objects, ...rest);
      return addAutomaticRainAudio(prepared, objects);
    };
    wrapped.__ephWeatherAudioV37 = true;
    wrapped.__ephPrevious = current;
    VMAP.prepareForSave = wrapped;
    installedPrepare = wrapped;
    return true;
  }

  installPrepare();
  window.addEventListener('eph-runtime-ready', installPrepare, { once: true });
  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    if (installedPrepare && VMAP.prepareForSave !== installedPrepare) installPrepare();
    if (checks >= 48) clearInterval(guard);
  }, 250);

  window.EPH_WEATHER_AUDIO_V37 = {
    exposedEvent: EXPOSED_EVENT,
    shelteredEvent: SHELTERED_EVENT,
    rebuild: (doc, objects) => addAutomaticRainAudio(doc, objects)
  };
  console.info('[Weather Audio V37] Automatic exposed/sheltered per-player rain soundscapes installed.');
})();
