// byanca
(() => {
  'use strict';
  if (window.__ephParticlePlacementV25) return;
  window.__ephParticlePlacementV25 = true;

  function normalizeParticlePath(value) {
    let path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (path.toLowerCase().endsWith('_c')) path = path.slice(0, -2);
    if (!path.toLowerCase().endsWith('.vpcf')) path += '.vpcf';
    return path;
  }

  function isParticleSystem(object) {
    return String(object?.className || '').trim().toLowerCase() === 'info_particle_system';
  }

  function decorateParticleSystem(object) {
    if (!isParticleSystem(object)) return object;
    object.ephParticleSystem = true;
    object.entityProperties ||= {};
    const effectName = normalizeParticlePath(object.entityProperties.effect_name || object.particleResource || '');
    if (effectName && effectName !== '.vpcf') {
      object.entityProperties.effect_name = effectName;
      object.particleResource = effectName;
    }
    object.entityProperties.start_active ??= '1';
    return object;
  }

  function nextParticleName() {
    let highest = 0;
    for (const object of S?.objects || []) {
      const match = String(object?.name || '').match(/^Particle_(\d+)$/i);
      if (match) highest = Math.max(highest, Number(match[1]) || 0);
    }
    return `Particle_${String(highest + 1).padStart(3, '0')}`;
  }

  function addMapAssetReference(resourcePath) {
    const prefix = S?.doc?.elements?.find?.(element => element?.className === '$prefix_element$');
    if (!prefix?.fields) return;
    let field = prefix.fields.find(item => item?.key === 'map_asset_references');
    if (!field) {
      field = { key: 'map_asset_references', type: 'string_array', value: [] };
      prefix.fields.push(field);
    }
    if (!Array.isArray(field.value)) field.value = [];
    if (!field.value.some(value => String(value).toLowerCase() === resourcePath.toLowerCase())) field.value.push(resourcePath);
  }

  function addParticle(item) {
    if (!S?.doc) return toast?.('Open a map first');
    const effectName = normalizeParticlePath(item?.path);
    if (!effectName || effectName === '.vpcf') return toast?.('Invalid particle resource');

    pushHistory?.();
    const name = nextParticleName();
    const object = ensureObject(VMAP.addEntity(S.doc, {
      className: 'info_particle_system',
      name,
      position: [0, 0, 32],
      rotation: [0, 0, 0],
      entityProperties: {
        effect_name: effectName,
        start_active: '1'
      }
    }));

    if (!object) {
      S.undo?.pop?.();
      toast?.('Could not create particle entity');
      return null;
    }

    object.type = 'entity';
    object.className = 'info_particle_system';
    object.name = name;
    decorateParticleSystem(object);
    object.entityProperties.effect_name = effectName;
    object.particleResource = effectName;
    addMapAssetReference(effectName);
    VMAP.applyObjectToDocument?.(S.doc, object);

    S.objects.push(object);
    S.selectedId = object.id;
    S.selectedFaces = new Set([0]);
    S.subSelection = null;
    S.viewport?.setObjects?.(S.objects, S.selectedId);
    S.viewport?.select?.(S.selectedId, false);
    setTool?.('move');
    markDirty?.(`Added particle ${effectName}`);
    renderTree?.();
    renderProperties?.();
    toast?.(`Placed ${item?.name || 'particle'} in map`);
    return object;
  }

  // The asset-manager pass used to copy particle paths on double-click. Capture
  // particle double-clicks first and turn them into real info_particle_system
  // map entities instead.
  document.addEventListener('dblclick', event => {
    if (S?.assetTab !== 'particles') return;
    const card = event.target?.closest?.('#assetGrid .asset-card');
    if (!card) return;
    const item = S.assetItems?.[Number(card.dataset.i)];
    if (!item) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addParticle(item);
  }, true);

  // Make the interaction explicit in the UI without changing the asset grid.
  const annotateCards = () => {
    if (S?.assetTab !== 'particles') return;
    document.querySelectorAll('#assetGrid .asset-card').forEach(card => {
      const item = S.assetItems?.[Number(card.dataset.i)];
      if (item) card.title = `${item.path || ''}\nDouble-click to place this particle in the map`;
    });
  };
  const grid = document.getElementById('assetGrid');
  if (grid) new MutationObserver(annotateCards).observe(grid, { childList: true });
  queueMicrotask(annotateCards);

  for (const object of S?.objects || []) decorateParticleSystem(object);

  window.EPH_PARTICLE_PLACEMENT = {
    add: addParticle,
    normalizeParticlePath,
    isParticleSystem,
    decorateParticleSystem
  };
  console.info('[Particle Placement V25] Particle assets create unified info_particle_system entities.');
})();
