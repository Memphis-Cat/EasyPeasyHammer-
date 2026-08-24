// byanca
(() => {
  'use strict';
  if (window.__ephHammerFgdVisualsV42) return;
  window.__ephHammerFgdVisualsV42 = true;

  const api = window.easyPeasyHammer;
  const catalog = new Map();
  let hydratePromise = null;
  let installedViewport = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;
  const key = value => String(value || '').trim().toLowerCase();
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const props = object => object?.entityProperties || {};

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Hammer FGD Visuals V42] ${message}`, meta || '');
    try { api?.appLog?.(level, 'hammer-fgd-visuals-v42', message, meta)?.catch?.(() => {}); } catch {}
  }

  async function hydrate() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = Promise.resolve(api?.getEntityCatalog?.()).then(result => {
      if (!result?.ok || !Array.isArray(result.entities)) throw new Error(result?.error || 'FGD catalog unavailable');
      catalog.clear();
      for (const entity of result.entities) catalog.set(key(entity?.className), entity);
      report('normal', `Loaded include-resolved Hammer catalog (${result.entities.length} entities / ${result.fgdFiles || 0} FGD files).`, {
        primaryFgd: result.primaryFgd || null,
        missingIncludes: result.missingIncludes?.length || 0,
        searchPaths: result.searchPaths || []
      });
      return result;
    }).catch(error => {
      report('error', 'Could not load Hammer FGD catalog.', { error: error?.message || String(error) });
      return null;
    });
    return hydratePromise;
  }

  function colorFor(hint, fallback = 0xffffff) {
    const T = THREE();
    const values = hint?.color || hint?.numbers?.slice?.(0, 3);
    if (Array.isArray(values) && values.length >= 3) return new T.Color(
      Math.max(0, Math.min(255, finite(values[0]))) / 255,
      Math.max(0, Math.min(255, finite(values[1]))) / 255,
      Math.max(0, Math.min(255, finite(values[2]))) / 255
    );
    return new T.Color(fallback);
  }

  function vectorValue(value, fallback = null) {
    const nums = String(value ?? '').trim().split(/[ ,]+/).map(Number).filter(Number.isFinite);
    if (nums.length >= 3) return nums.slice(0, 3);
    return fallback;
  }

  function propertyVector(object, name, fallback = null) {
    return vectorValue(props(object)?.[String(name || '').trim()], fallback);
  }

  function propertyNumber(object, token, fallback) {
    const direct = Number(token);
    if (Number.isFinite(direct)) return Math.abs(direct);
    const value = Number(props(object)?.[String(token || '').trim()]);
    return Number.isFinite(value) ? Math.abs(value) : fallback;
  }

  function tokens(raw) {
    return String(raw || '').replace(/[{}]/g, ' ').split(',').flatMap(chunk => chunk.trim().split(/\s+/)).map(value => value.replace(/^"|"$/g, '')).filter(Boolean);
  }

  function helperGroup() {
    const T = THREE();
    const group = new T.Group();
    group.userData.ephVisual = true;
    group.userData.ephHammerFgdVisual = true;
    return group;
  }

  function wireBox(bounds, color) {
    const T = THREE();
    if (!bounds?.min || !bounds?.max) return null;
    const min = bounds.min.map(value => finite(value)), max = bounds.max.map(value => finite(value));
    const size = [Math.max(.01, max[0] - min[0]), Math.max(.01, max[1] - min[1]), Math.max(.01, max[2] - min[2])];
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const edges = new T.EdgesGeometry(new T.BoxGeometry(...size));
    const line = new T.LineSegments(edges, new T.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: .95, toneMapped: false }));
    line.position.set(...center); line.renderOrder = 850; line.userData.ephHelper = true;
    return line;
  }

  function fallbackVisual(object, meta) {
    const T = THREE();
    const boundHint = (meta?.renderHints || []).find(hint => hint?.bounds);
    const bounds = boundHint?.bounds || { min: [-8, -8, -8], max: [8, 8, 8] };
    return wireBox(bounds, colorFor(boundHint || meta?.renderHint, 0x6ea8d8)) || new T.Object3D();
  }

  function modelVisual(viewport, object, resource) {
    const T = THREE();
    const group = helperGroup();
    group.userData.ephModelResource = resource;
    Promise.resolve(viewport.loadModel?.(resource)).then(data => {
      if (!data?.scene || !group.parent) return;
      const cloneSkeleton = window.EPH_THREE_HELPERS?.cloneSkeleton;
      const model = cloneSkeleton ? cloneSkeleton(data.scene) : data.scene.clone(true);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.geometry = child.geometry?.clone?.() || child.geometry;
        if (Array.isArray(child.material)) child.material = child.material.map(material => material?.clone?.() || material);
        else if (child.material?.clone) child.material = child.material.clone();
        child.castShadow = false; child.receiveShadow = false;
      });
      const basis = new T.Group();
      basis.name = 'HammerSource2ModelBasis';
      basis.quaternion.set(0.5, 0.5, 0.5, 0.5).normalize();
      basis.scale.setScalar(Number(data.scale) || 39.37007874015748);
      basis.add(model); group.add(basis);
      if (viewport.selectedId === object?.id) viewport.updateSelectionBox?.();
    }).catch(error => report('warning', `Could not render FGD model ${resource}`, { className: object?.className, error: error?.message || String(error) }));
    return group;
  }

  function spriteVisual(viewport, object, hint) {
    const T = THREE();
    const group = helperGroup();
    Promise.resolve(viewport.loadMaterialTexture?.(hint.resource)).then(texture => {
      if (!texture || !group.parent) return;
      const material = new T.SpriteMaterial({ map: texture, color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const sprite = new T.Sprite(material);
      const bounds = (catalog.get(key(object?.className))?.renderHints || []).find(item => item?.bounds)?.bounds;
      const width = bounds ? Math.max(16, Math.abs(bounds.max[0] - bounds.min[0])) : 32;
      const height = bounds ? Math.max(16, Math.abs(bounds.max[2] - bounds.min[2])) : 32;
      sprite.scale.set(width, height, 1); sprite.renderOrder = 1000; sprite.userData.ephHelper = true;
      group.add(sprite);
      if (viewport.selectedId === object?.id) viewport.updateSelectionBox?.();
    }).catch(error => report('warning', `Could not render FGD icon ${hint.resource}`, { className: object?.className, error: error?.message || String(error) }));
    return group;
  }

  function sphereVisual(object, hint) {
    const T = THREE();
    const first = tokens(hint.args)[0] || '';
    const radius = Math.max(2, propertyNumber(object, first, 24));
    const mesh = new T.Mesh(new T.SphereGeometry(radius, 18, 12), new T.MeshBasicMaterial({ color: colorFor(hint), wireframe: true, transparent: true, opacity: .82, depthTest: false, toneMapped: false }));
    mesh.renderOrder = 820; mesh.userData.ephHelper = true; return mesh;
  }

  function vectorLine(end, color) {
    const T = THREE();
    const geometry = new T.BufferGeometry().setFromPoints([new T.Vector3(), end]);
    const line = new T.Line(geometry, new T.LineBasicMaterial({ color, depthTest: false, toneMapped: false }));
    line.renderOrder = 830; line.userData.ephHelper = true; return line;
  }

  function targetByName(name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    return (state()?.objects || []).find(object => String(object?.name || object?.entityProperties?.targetname || '').trim().toLowerCase() === wanted) || null;
  }

  function localDeltaToTarget(object, target) {
    const T = THREE();
    const from = new T.Vector3(...(object?.position || [0, 0, 0]));
    const to = new T.Vector3(...(target?.position || [0, 0, 0]));
    const delta = to.sub(from);
    const q = window.EPH_COORDINATES?.qAngleToQuaternion?.(object?.rotation || [0, 0, 0]);
    if (q) delta.applyQuaternion(q.clone().invert());
    return delta;
  }

  function lineVisual(object, hint) {
    const T = THREE();
    const parts = String(hint.args || '').split(',').map(value => value.trim()).filter(Boolean);
    const colorNumbers = (parts[0] || '').split(/\s+/).map(Number).filter(Number.isFinite);
    const color = colorNumbers.length >= 3 ? new T.Color(colorNumbers[0] / 255, colorNumbers[1] / 255, colorNumbers[2] / 255) : colorFor(hint);
    const destinationKey = parts[parts.length - 1] || '';
    const raw = props(object)?.[destinationKey];
    const vector = vectorValue(raw);
    if (vector) return vectorLine(new T.Vector3(...vector), color);
    const target = targetByName(raw);
    if (target) return vectorLine(localDeltaToTarget(object, target), color);
    return null;
  }

  function vecLineLocalVisual(object, hint) {
    const T = THREE();
    const first = String(hint.args || '').split(',')[0]?.trim() || '';
    const value = propertyVector(object, first);
    return value ? vectorLine(new T.Vector3(...value), colorFor(hint)) : null;
  }

  function drawAnglesVisual(hint) {
    const T = THREE();
    const group = helperGroup();
    const color = colorFor(hint, 0xffffff);
    group.add(vectorLine(new T.Vector3(42, 0, 0), color));
    const cone = new T.Mesh(new T.ConeGeometry(3.5, 10, 8), new T.MeshBasicMaterial({ color, depthTest: false, toneMapped: false }));
    cone.rotation.z = -Math.PI / 2; cone.position.x = 42; cone.userData.ephHelper = true; group.add(cone);
    return group;
  }

  function dynamicBoxVisual(object, hint) {
    const t = tokens(hint.args);
    let min = null, max = null;
    if (hint.type === 'centered_box_oriented') {
      const name = String(hint.args || '').match(/box_size\s*=\s*"([^"]+)"/i)?.[1] || t[0];
      const size = propertyVector(object, name);
      if (size) { const half = size.map(value => Math.abs(value) / 2); min = half.map(value => -value); max = half; }
    } else if (hint.type === 'orientedwidthheight') {
      const width = propertyNumber(object, t[0], 32), height = propertyNumber(object, t[1], 32);
      min = [-1, -width / 2, -height / 2]; max = [1, width / 2, height / 2];
    } else {
      min = propertyVector(object, t[0]); max = propertyVector(object, t[1]);
    }
    return min && max ? wireBox({ min, max }, colorFor(hint)) : null;
  }

  function frustumVisual(object, hint) {
    const T = THREE();
    const t = String(hint.args || '').split(',').map(value => value.trim()).filter(Boolean);
    const fov = Math.max(1, Math.min(175, propertyNumber(object, t[0], 60))) * Math.PI / 180;
    const near = Math.max(.1, propertyNumber(object, t[1], 4));
    const far = Math.max(near + .1, propertyNumber(object, t[2], 64));
    const color = colorFor(hint);
    const group = helperGroup();
    const addRect = (x, half) => {
      const points = [new T.Vector3(x, -half, -half), new T.Vector3(x, half, -half), new T.Vector3(x, half, half), new T.Vector3(x, -half, half), new T.Vector3(x, -half, -half)];
      const geometry = new T.BufferGeometry().setFromPoints(points);
      group.add(new T.Line(geometry, new T.LineBasicMaterial({ color, depthTest: false, toneMapped: false })));
      return points.slice(0, 4);
    };
    const nearPts = addRect(near, Math.tan(fov / 2) * near), farPts = addRect(far, Math.tan(fov / 2) * far);
    for (let i = 0; i < 4; i++) {
      const geometry = new T.BufferGeometry().setFromPoints([nearPts[i], farPts[i]]);
      group.add(new T.Line(geometry, new T.LineBasicMaterial({ color, depthTest: false, toneMapped: false })));
    }
    group.children.forEach(child => { child.renderOrder = 820; child.userData.ephHelper = true; });
    return group;
  }

  function arcVisual(object, hint) {
    const T = THREE();
    const radius = Math.max(4, finite(String(hint.args || '').match(/radius\s*=\s*"?([\d.]+)/i)?.[1], 50));
    const fovKey = String(hint.args || '').match(/fov_key\s*=\s*"([^"]+)"/i)?.[1] || '';
    const fov = Math.max(1, Math.min(360, propertyNumber(object, fovKey, 90))) * Math.PI / 180;
    const steps = 24, points = [new T.Vector3()];
    for (let i = 0; i <= steps; i++) {
      const angle = -fov / 2 + fov * i / steps;
      points.push(new T.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }
    points.push(new T.Vector3());
    const geometry = new T.BufferGeometry().setFromPoints(points);
    const line = new T.Line(geometry, new T.LineBasicMaterial({ color: colorFor(hint), depthTest: false, toneMapped: false }));
    line.renderOrder = 820; line.userData.ephHelper = true; return line;
  }

  function helperVisual(viewport, object, hint) {
    if (!hint) return null;
    switch (String(hint.type || '').toLowerCase()) {
      case 'editormodel': case 'studio': return hint.resource ? modelVisual(viewport, object, hint.resource) : null;
      case 'iconsprite': case 'sprite': return hint.resource ? spriteVisual(viewport, object, hint) : null;
      case 'wirebox': return wireBox(hint.bounds, colorFor(hint));
      case 'sphere': return sphereVisual(object, hint);
      case 'line': case 'selected_line': return lineVisual(object, hint);
      case 'vecline_local': return vecLineLocalVisual(object, hint);
      case 'drawangles': case 'drawangles_local': return drawAnglesVisual(hint);
      case 'box_oriented': case 'box_world_aligned': case 'centered_box_oriented': case 'orientedwidthheight': case 'volumetric_fog_controller': return dynamicBoxVisual(object, hint);
      case 'frustum': return frustumVisual(object, hint);
      case 'arc_range': return arcVisual(object, hint);
      case 'light': case 'lightcone': return drawAnglesVisual(hint);
      default: return null;
    }
  }

  function installViewport(viewport = window.EPH3D || state()?.viewport) {
    const T = THREE();
    if (!viewport || !T || !catalog.size) return false;
    if (viewport.createEntityMarker?.__ephHammerFgdVisualsV42) { installedViewport = viewport; return true; }

    const create = function(object) {
      const meta = catalog.get(key(object?.className));
      const group = helperGroup();
      const hints = Array.isArray(meta?.renderHints) ? meta.renderHints : [];
      const explicitModel = String(object?.model || object?.entityProperties?.model || '').trim();
      const seenModels = new Set();
      let visible = 0;

      if (explicitModel) {
        group.add(modelVisual(this, object, explicitModel));
        seenModels.add(key(explicitModel)); visible++;
      }

      const hasPrimary = Boolean(explicitModel || hints.some(hint => ['editormodel', 'studio', 'iconsprite', 'sprite'].includes(String(hint?.type || '').toLowerCase())));
      for (const hint of hints) {
        const type = String(hint?.type || '').toLowerCase();
        if ((type === 'editormodel' || type === 'studio') && seenModels.has(key(hint.resource))) continue;
        if (type === 'bbox' && hint.selectionBounds && hasPrimary) continue;
        if (type === 'bbox') {
          if (!hasPrimary) { const box = wireBox(hint.bounds, colorFor(hint)); if (box) { group.add(box); visible++; } }
          continue;
        }
        const visual = helperVisual(this, object, hint);
        if (!visual) continue;
        if (type === 'editormodel' || type === 'studio') seenModels.add(key(hint.resource));
        group.add(visual); visible++;
      }

      if (!visible) group.add(fallbackVisual(object, meta));
      return group;
    };
    create.__ephHammerFgdVisualsV42 = true;
    create.__ephHammerFinalV18 = true;
    create.__ephEntityModelBasisV41 = true;
    viewport.createEntityMarker = create;
    installedViewport = viewport;

    queueMicrotask(() => {
      for (const object of state()?.objects || []) if (object?.type === 'entity') viewport.updateObject?.(object);
      viewport.updateSelectionBox?.();
    });
    report('normal', 'Installed generic Hammer FGD helper renderer for all entities.');
    return true;
  }

  async function install() {
    await hydrate();
    return installViewport();
  }

  window.EPH_HAMMER_FGD_VISUALS_V42 = { install, catalog };
  install();
  window.addEventListener('eph-fgd-catalog-ready', () => { hydratePromise = null; install(); });
  window.addEventListener('eph3d-ready', () => install());
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });
  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const viewport = window.EPH3D || state()?.viewport;
    if (catalog.size && viewport && !viewport.createEntityMarker?.__ephHammerFgdVisualsV42) installViewport(viewport);
    if (checks >= 120) clearInterval(guard);
  }, 250);
})();
