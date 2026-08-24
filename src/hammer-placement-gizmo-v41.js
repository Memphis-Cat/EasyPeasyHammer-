// byanca
(() => {
  'use strict';
  if (window.__ephHammerPlacementGizmoV41) return;
  window.__ephHammerPlacementGizmoV41 = true;

  const VMAP = window.EPH_VMAP;
  const placedObjects = new WeakSet();
  const EPSILON = 0.04;
  const FALLBACK_DISTANCE = 224;
  let viewport = null;
  let railGroup = null;
  let railFrame = 0;
  let wrappedAddPart = null;
  let wrappedAddProp = null;
  let wrappedAddEntity = null;
  let wrappedWeatherAdd = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;

  function objectById(id) {
    return (state()?.objects || []).find(object => object?.id === id) || null;
  }

  function report(message, meta = null) {
    console.info(`[Hammer Placement / Gizmo V41] ${message}`, meta || '');
    try { window.easyPeasyHammer?.appLog?.('normal', 'hammer-placement-gizmo-v41', message, meta)?.catch?.(() => {}); } catch {}
  }

  function surfaceCandidate(object) {
    if (!object || object.visible === false || object.ephNegative) return false;
    if (['part', 'terrain', 'prop', 'decal'].includes(object.type)) return object.type !== 'decal';
    if (object.type === 'entity' && (object.ephMeshEntity || object.ephMeshChildIds?.length)) return true;
    return false;
  }

  function centerRay(viewport, excludeId = null) {
    const T = THREE();
    if (!T || !viewport?.camera || !viewport?.raycaster) return null;
    viewport.raycaster.setFromCamera(new T.Vector2(0, 0), viewport.camera);

    const roots = [];
    for (const [id, root] of viewport.objectRoots || []) {
      if (id === excludeId || !root?.visible || !surfaceCandidate(objectById(id))) continue;
      roots.push(root);
    }
    if (!roots.length) return null;

    const hits = viewport.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (!hit?.point || !hit.object) continue;
      let normal = null;
      if (hit.face?.normal) {
        normal = hit.face.normal.clone();
        const normalMatrix = new T.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        normal.applyMatrix3(normalMatrix).normalize();
      }
      if (!normal || normal.lengthSq() < 1e-8) {
        normal = viewport.camera.getWorldDirection(new T.Vector3()).multiplyScalar(-1).normalize();
      }
      return { point: hit.point.clone(), normal, object: hit.object, distance: hit.distance };
    }
    return null;
  }

  function cameraFallback(viewport) {
    const T = THREE();
    const direction = viewport.camera.getWorldDirection(new T.Vector3()).normalize();
    return viewport.camera.position.clone().addScaledVector(direction, FALLBACK_DISTANCE);
  }

  function boxCorners(box) {
    const T = THREE();
    const corners = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) corners.push(new T.Vector3(x, y, z));
      }
    }
    return corners;
  }

  function shouldRestWholeVisual(object, kind = '') {
    if (!object) return false;
    if (kind === 'particle' || object.ephParticleSystem) return false;
    if (object.type === 'entity' && !object.ephWeatherVolume) return false;
    return ['part', 'terrain', 'prop'].includes(object.type) || object.ephWeatherVolume;
  }

  function writePosition(object, position, update = true) {
    const s = state();
    object.position = [position.x, position.y, position.z];
    VMAP?.applyObjectToDocument?.(s?.doc, object);
    if (update) s?.viewport?.updateObject?.(object);
  }

  function settleOnPlane(object, hit, kind = '') {
    const s = state();
    const vp = s?.viewport || viewport || window.EPH3D;
    const T = THREE();
    const root = vp?.objectRoots?.get?.(object?.id);
    if (!T || !root || !hit?.point || !hit?.normal || !shouldRestWholeVisual(object, kind)) return false;

    root.updateMatrixWorld?.(true);
    const box = new T.Box3().setFromObject(root);
    if (box.isEmpty()) return false;

    let minimum = Infinity;
    for (const corner of boxCorners(box)) minimum = Math.min(minimum, hit.normal.dot(corner.clone().sub(hit.point)));
    if (!Number.isFinite(minimum) || minimum >= EPSILON) return false;

    const shift = hit.normal.clone().multiplyScalar(EPSILON - minimum);
    const next = root.position.clone().add(shift);
    writePosition(object, next, true);
    return true;
  }

  function placeCreated(object, options = {}) {
    const s = state();
    const vp = s?.viewport || viewport || window.EPH3D;
    const T = THREE();
    if (!object || !vp?.camera || !T) return object;
    if (placedObjects.has(object) && !options.force) return object;
    placedObjects.add(object);

    // The center of the 3D viewport is authoritative. Existing map geometry is
    // raycast before the new object is positioned, with the new object's root
    // explicitly excluded so it cannot place against itself.
    const hit = centerRay(vp, object.id);
    let position;
    if (hit) position = hit.point.clone().addScaledVector(hit.normal, EPSILON);
    else position = cameraFallback(vp);

    writePosition(object, position, true);

    if (hit) {
      settleOnPlane(object, hit, options.kind || '');
      // Props swap their placeholder for the real Source 2 model asynchronously.
      // Re-settle against the same surface after those swaps so a large model
      // cannot suddenly clip through the wall/floor it was created on.
      if (object.type === 'prop' || object.ephWeatherVolume) {
        for (const delay of [60, 180, 500, 1200]) {
          setTimeout(() => {
            if (!(state()?.objects || []).includes(object)) return;
            settleOnPlane(object, hit, options.kind || '');
          }, delay);
        }
      }
    }

    s.selectedId = object.id;
    s.selectedFaces = new Set([0]);
    s.subSelection = null;
    vp.select?.(object.id, false);
    try { renderTree?.(); renderProperties?.(); } catch {}
    report(`Placed ${object.name || object.className || object.type} at POV center${hit ? ' surface' : ''}.`, {
      position: object.position,
      surface: Boolean(hit),
      kind: options.kind || object.type
    });
    return object;
  }

  function createdAfter(before, preferredType = null) {
    const s = state();
    const selected = objectById(s?.selectedId);
    if (selected && !before.has(selected.id) && (!preferredType || selected.type === preferredType)) return selected;
    return (s?.objects || []).find(object => object?.id && !before.has(object.id) && (!preferredType || object.type === preferredType)) || null;
  }

  function wrapGlobalCreation(name, getCurrent, assign, preferredType, kind) {
    const current = getCurrent();
    if (typeof current !== 'function') return null;
    if (current.__ephPovPlacementV41) return current;

    const wrapped = function(...args) {
      const before = new Set((state()?.objects || []).map(object => object?.id));
      const result = current.apply(this, args);
      const finish = resolved => {
        const object = (resolved && typeof resolved === 'object' && resolved.id ? resolved : null) || createdAfter(before, preferredType);
        if (object) placeCreated(object, { kind });
        return resolved;
      };
      if (result?.then) return result.then(finish);
      finish(result);
      return result;
    };
    for (const key of Object.keys(current)) if (key.startsWith('__eph')) wrapped[key] = current[key];
    wrapped.__ephPovPlacementV41 = true;
    wrapped.__ephPrevious = current;
    assign(wrapped);
    return wrapped;
  }

  function installCreationWrappers() {
    wrappedAddPart = wrapGlobalCreation(
      'addPart',
      () => { try { return addPart; } catch { return window.addPart; } },
      fn => { try { addPart = fn; } catch {} window.addPart = fn; },
      'part', 'part'
    ) || wrappedAddPart;

    wrappedAddProp = wrapGlobalCreation(
      'addProp',
      () => { try { return addProp; } catch { return window.addProp; } },
      fn => { try { addProp = fn; } catch {} window.addProp = fn; },
      'prop', 'prop'
    ) || wrappedAddProp;

    wrappedAddEntity = wrapGlobalCreation(
      'addEntity',
      () => { try { return addEntity; } catch { return window.addEntity; } },
      fn => { try { addEntity = fn; } catch {} window.addEntity = fn; },
      'entity', 'entity'
    ) || wrappedAddEntity;

    // Part Numbering binds the button directly to its private creator. Rebind it
    // to the final wrapped global creator so toolbar and keyboard creation use
    // the exact same center-POV placement path.
    const partButton = document.getElementById('topAddPart');
    if (partButton && wrappedAddPart && partButton.onclick !== wrappedAddPart) partButton.onclick = wrappedAddPart;

    const weather = window.EPH_WEATHER_VOLUME;
    if (weather?.add && !weather.add.__ephPovPlacementV41) {
      const raw = weather.add;
      const wrapped = function(...args) {
        const before = new Set((state()?.objects || []).map(object => object?.id));
        const result = raw.apply(this, args);
        const object = (result && typeof result === 'object' && result.id ? result : null) || createdAfter(before, 'part');
        if (object) placeCreated(object, { kind: 'weather' });
        return result;
      };
      wrapped.__ephPovPlacementV41 = true;
      wrapped.__ephPrevious = raw;
      weather.add = wrapped;
      wrappedWeatherAdd = wrapped;
    } else if (weather?.add?.__ephPovPlacementV41) wrappedWeatherAdd = weather.add;
  }

  function makeAxisRail(T, direction, color) {
    const geometry = new T.BufferGeometry().setFromPoints([
      new T.Vector3(0, 0, 0),
      direction.clone().multiplyScalar(-1)
    ]);
    const material = new T.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: false, toneMapped: false });
    const line = new T.Line(geometry, material);
    line.renderOrder = 10000;
    line.frustumCulled = false;
    return line;
  }

  function installHammerGizmo(vp) {
    const T = THREE();
    if (!vp?.scene || !vp?.transform || !T) return false;
    viewport = vp;
    if (railGroup?.parent) return true;

    railGroup = new T.Group();
    railGroup.name = 'EPH_HammerNegativeAxisRails';
    // Hammer shows the shaft continuing through the pivot opposite the arrow.
    // Three.js TransformControls only supplies the positive arrow shaft, so add
    // the missing negative half for all three axes without changing interaction.
    railGroup.add(makeAxisRail(T, new T.Vector3(1, 0, 0), 0xff3653));
    railGroup.add(makeAxisRail(T, new T.Vector3(0, 1, 0), 0x65d63d));
    railGroup.add(makeAxisRail(T, new T.Vector3(0, 0, 1), 0x287dff));
    railGroup.visible = false;
    vp.scene.add(railGroup);

    const update = () => {
      railFrame = requestAnimationFrame(update);
      if (!railGroup || !viewport?.transform) return;
      const target = viewport.transform.object;
      const translate = target && String(viewport.transform.mode || '') === 'translate';
      railGroup.visible = Boolean(translate);
      if (!translate) return;

      const position = target.getWorldPosition(new T.Vector3());
      railGroup.position.copy(position);
      if (String(viewport.transform.space || 'world').toLowerCase() === 'local') {
        railGroup.quaternion.copy(target.getWorldQuaternion(new T.Quaternion()));
      } else railGroup.quaternion.identity();

      const rect = viewport.renderer?.domElement?.getBoundingClientRect?.();
      const height = Math.max(1, rect?.height || 720);
      const distance = Math.max(0.01, viewport.camera.position.distanceTo(position));
      const fov = (Number(viewport.camera.fov) || 65) * Math.PI / 180;
      const worldPerPixel = 2 * distance * Math.tan(fov * 0.5) / height;
      const length = Math.max(0.25, worldPerPixel * 47);
      railGroup.scale.setScalar(length);
    };
    update();
    report('Hammer-style negative move-axis rails installed.');
    return true;
  }

  function install(vp = window.EPH3D || state()?.viewport) {
    installHammerGizmo(vp);
    installCreationWrappers();
    return Boolean(vp);
  }

  window.EPH_POV_PLACEMENT_V41 = {
    placeCreated,
    centerRay: (excludeId = null) => centerRay(window.EPH3D || state()?.viewport, excludeId),
    reinstall: install
  };

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const vp = window.EPH3D || state()?.viewport;
    if (vp && viewport !== vp) installHammerGizmo(vp);
    const partNow = (() => { try { return addPart; } catch { return window.addPart; } })();
    const propNow = (() => { try { return addProp; } catch { return window.addProp; } })();
    const entityNow = (() => { try { return addEntity; } catch { return window.addEntity; } })();
    if (partNow !== wrappedAddPart || propNow !== wrappedAddProp || entityNow !== wrappedAddEntity || (window.EPH_WEATHER_VOLUME?.add && window.EPH_WEATHER_VOLUME.add !== wrappedWeatherAdd)) installCreationWrappers();
    else {
      const button = document.getElementById('topAddPart');
      if (button && wrappedAddPart && button.onclick !== wrappedAddPart) button.onclick = wrappedAddPart;
    }
    if (checks >= 80) clearInterval(guard);
  }, 250);

  window.addEventListener('beforeunload', () => { if (railFrame) cancelAnimationFrame(railFrame); }, { once: true });
  report('Center-POV surface placement enabled for new Parts, Props, Entities and particle/weather creation paths.');
})();
