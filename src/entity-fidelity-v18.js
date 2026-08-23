// byanca
(() => {
  'use strict';
  if (window.__ephEntityFidelityV18) return;
  window.__ephEntityFidelityV18 = true;

  const api = window.easyPeasyHammer;
  const catalog = new Map();
  const reportedFallbacks = new Set();
  let hydratePromise = null;

  const key = value => String(value || '').toLowerCase();
  const metaFor = className => catalog.get(key(className)) || (Array.isArray(ENTITIES) ? ENTITIES.find(item => key(item?.className) === key(className)) : null);

  function report(level, message, data = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Hammer Entity] ${message}`, data || '');
    api?.appLog?.(level, 'entity-visual', message, data).catch?.(() => {});
  }

  async function hydrate() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      const result = await api?.getEntityCatalog?.();
      if (!result?.ok || !Array.isArray(result.entities)) throw new Error(result?.error || 'FGD catalog unavailable.');
      catalog.clear();
      for (const entity of result.entities) catalog.set(key(entity.className), entity);
      report('normal', `FGD visual catalog ready (${result.entities.length} entities).`, { point: result.pointEntities, solid: result.solidEntities, files: result.fgdFiles, parseErrors: result.parseErrors || 0 });
      return result;
    })().catch(error => { report('error', 'Could not hydrate FGD visual metadata.', error); return null; });
    return hydratePromise;
  }

  function checkerBox(viewport, object) {
    const THREE = window.EPH_THREE || window.THREE;
    if (!THREE) return null;
    const size = object?.size || [24, 24, 24];
    const geometry = new THREE.BoxGeometry(Math.max(8, Number(size[0]) || 24), Math.max(8, Number(size[1]) || 24), Math.max(8, Number(size[2]) || 24));
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, map: viewport.errorTexture || null });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.ephVisual = true;
    mesh.userData.ephErrorFallback = true;
    return mesh;
  }

  function errorVisual(viewport, object, reason) {
    const identity = `${object?.className || object?.name || 'entity'}|${reason || ''}`;
    if (!reportedFallbacks.has(identity)) {
      reportedFallbacks.add(identity);
      report('warning', `Showing ERROR helper for ${object?.className || object?.name || 'entity'}: ${reason || 'no Hammer visual metadata'}`);
    }
    return checkerBox(viewport, object);
  }

  function modelVisual(viewport, object, resource) {
    const THREE = window.EPH_THREE || window.THREE;
    const group = new THREE.Group();
    group.userData.ephVisual = true;
    const fallback = checkerBox(viewport, object);
    if (fallback) group.add(fallback);
    report('normal', `Loading Hammer editor model for ${object?.className || object?.name || 'entity'}: ${resource}`);
    viewport.loadModel(resource).then(data => {
      if (!data?.scene) {
        report('warning', `Hammer editor model could not be loaded: ${resource}`, { className: object?.className });
        return;
      }
      if (!group.parent && !group.userData.ephAllowDetachedLoad) return;
      try {
        const model = data.scene.clone(true);
        model.rotation.x = Math.PI / 2;
        model.scale.setScalar(Number(data.scale) || 39.37007874015748);
        model.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = false;
          child.receiveShadow = false;
          if (child.geometry?.clone) child.geometry = child.geometry.clone();
          if (Array.isArray(child.material)) child.material = child.material.map(material => material?.clone?.() || material);
          else if (child.material?.clone) child.material = child.material.clone();
        });
        if (fallback) { group.remove(fallback); viewport.disposeObject?.(fallback); }
        group.add(model);
        if (viewport.selectedId === object?.id) viewport.updateSelectionBox?.();
        report('normal', `Loaded Hammer editor model for ${object?.className || object?.name}: ${resource}`);
      } catch (error) {
        report('error', `Could not display Hammer editor model ${resource}`, error);
      }
    }).catch(error => report('error', `Hammer editor model load failed: ${resource}`, error));
    return group;
  }

  function spriteVisual(viewport, object, hint) {
    const THREE = window.EPH_THREE || window.THREE;
    const group = new THREE.Group();
    group.userData.ephVisual = true;
    const fallback = checkerBox(viewport, object);
    if (fallback) group.add(fallback);
    report('normal', `Loading Hammer editor sprite for ${object?.className || object?.name || 'entity'}: ${hint.resource}`);
    viewport.loadMaterialTexture(hint.resource).then(texture => {
      if (!texture) {
        report('warning', `Hammer editor sprite could not be loaded: ${hint.resource}`, { className: object?.className });
        return;
      }
      const material = new THREE.SpriteMaterial({ map: texture, color: 0xffffff, transparent: true, depthTest: false, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      const bounds = hint.bounds;
      const width = bounds ? Math.max(12, Math.abs(bounds.max[0] - bounds.min[0])) : 32;
      const height = bounds ? Math.max(12, Math.abs(bounds.max[2] - bounds.min[2])) : 32;
      sprite.scale.set(width, height, 1);
      sprite.renderOrder = 900;
      if (fallback) { group.remove(fallback); viewport.disposeObject?.(fallback); }
      group.add(sprite);
      report('normal', `Loaded Hammer editor sprite for ${object?.className || object?.name}: ${hint.resource}`);
    }).catch(error => report('error', `Hammer editor sprite failed: ${hint.resource}`, error));
    return group;
  }

  function colorFor(THREE, hint) {
    if (Array.isArray(hint?.color) && hint.color.length >= 3) return new THREE.Color(Math.min(255, hint.color[0]) / 255, Math.min(255, hint.color[1]) / 255, Math.min(255, hint.color[2]) / 255);
    return new THREE.Color(0xffffff);
  }

  function wireBox(object, hint) {
    const THREE = window.EPH_THREE || window.THREE;
    const bounds = hint?.bounds || { min: [-8, -8, -8], max: [8, 8, 8] };
    const min = bounds.min || [-8, -8, -8], max = bounds.max || [8, 8, 8];
    const size = [Math.max(.01, max[0] - min[0]), Math.max(.01, max[1] - min[1]), Math.max(.01, max[2] - min[2])];
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(...size));
    const visual = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: colorFor(THREE, hint), depthTest: false, transparent: true, opacity: .95 }));
    visual.position.set(...center);
    visual.renderOrder = 800;
    visual.userData.ephVisual = true;
    return visual;
  }

  function helperNumber(object, token, fallback) {
    const direct = Number(token);
    if (Number.isFinite(direct)) return Math.abs(direct);
    const value = Number(object?.entityProperties?.[String(token || '').trim()]);
    return Number.isFinite(value) ? Math.abs(value) : fallback;
  }

  function proceduralHelper(object, hint) {
    const THREE = window.EPH_THREE || window.THREE;
    const type = String(hint?.type || '').toLowerCase();
    const tokens = String(hint?.args || '').replace(/[{},]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const color = colorFor(THREE, hint);

    if (type === 'sphere') {
      const radius = Math.max(4, helperNumber(object, tokens[0], 24));
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 10), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .8, depthTest: false }));
      mesh.userData.ephVisual = true;
      return mesh;
    }
    if (type === 'cylinder') {
      const radius = Math.max(4, helperNumber(object, tokens[0], 16));
      const height = Math.max(8, helperNumber(object, tokens[1], 32));
      const edges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(radius, radius, height, 16));
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, depthTest: false }));
      line.rotation.x = Math.PI / 2;
      line.userData.ephVisual = true;
      return line;
    }
    if (['line', 'path'].includes(type)) {
      const raw = object?.entityProperties?.[tokens[0]] || object?.entityProperties?.attachpoint || '0 0 32';
      const nums = String(raw).split(/[ ,]+/).map(Number);
      const end = new THREE.Vector3(Number(nums[0]) || 0, Number(nums[1]) || 0, Number(nums[2]) || 32);
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), end]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
      line.userData.ephVisual = true;
      return line;
    }
    if (['decal', 'quadbounds'].includes(type)) {
      const edges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(32, 32));
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, depthTest: false }));
      line.userData.ephVisual = true;
      return line;
    }
    if (['light', 'frustum'].includes(type)) {
      const group = new THREE.Group();
      const marker = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), new THREE.MeshBasicMaterial({ color }));
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -48)]);
      group.add(marker, new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false })));
      group.userData.ephVisual = true;
      return group;
    }
    return null;
  }

  function installMarker() {
    const viewport = window.EPH3D || S?.viewport;
    const THREE = window.EPH_THREE || window.THREE;
    if (!viewport || !THREE || !viewport.__ephAdvancedViewport) return false;
    if (viewport.createEntityMarker?.__ephHammerFinalV18) return true;

    viewport.createEntityMarker = function(object) {
      const meta = metaFor(object?.className);
      const model = String(object?.model || object?.entityProperties?.model || meta?.model || '').trim();
      if (model) return modelVisual(this, object, model);

      const hints = Array.isArray(meta?.renderHints) && meta.renderHints.length ? meta.renderHints : meta?.renderHint ? [meta.renderHint] : [];
      const sprite = hints.find(hint => ['iconsprite', 'sprite'].includes(String(hint?.type || '').toLowerCase()) && hint.resource);
      if (sprite) return spriteVisual(this, object, sprite);
      const bounds = hints.find(hint => hint?.bounds || ['bbox', 'wirebox'].includes(String(hint?.type || '').toLowerCase()));
      if (bounds) return wireBox(object, bounds);
      for (const hint of hints) {
        const visual = proceduralHelper(object, hint);
        if (visual) return visual;
      }
      return errorVisual(this, object, meta ? 'FGD has no supported editor helper' : 'class not found in installed CS2 FGD');
    };
    viewport.createEntityMarker.__ephHammerFinalV18 = true;
    report('normal', 'Hammer FGD entity renderer installed after Advanced Viewport.');
    for (const object of S?.objects || []) if (object && ['entity', 'prop'].includes(object.type)) viewport.updateObject?.(object);
    return true;
  }

  async function start() {
    await hydrate();
    installMarker();
  }

  window.addEventListener('eph-fgd-catalog-ready', () => { hydratePromise = null; start(); });
  window.addEventListener('eph3d-ready', start, { once: true });
  start();

  // A few enhancement passes load asynchronously after the base viewport. Keep
  // checking for a short bounded window and reclaim createEntityMarker if an old
  // pass overwrites it with the generic octahedron renderer again.
  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    installMarker();
    if (checks >= 40) clearInterval(guard);
  }, 250);
})();
