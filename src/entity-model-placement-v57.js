// byanca
(() => {
  'use strict';
  if (window.__ephEntityModelPlacementV57) return;
  window.__ephEntityModelPlacementV57 = true;

  const VMAP = window.EPH_VMAP;
  const OFFSET = 0.05;
  let wrappedAddEntity = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;
  const viewport = () => window.EPH3D || state()?.viewport || null;

  function objectById(id) {
    return (state()?.objects || []).find(object => object?.id === id) || null;
  }

  function modelPath(object) {
    if (!object) return '';
    return String(
      object.model
      || object.entityProperties?.model
      || object.entityProperties?.modelname
      || object.entityProperties?.worldmodel
      || ''
    ).trim();
  }

  function isModelSurface(object) {
    if (!object || object.visible === false || object.ephNegative || object.type === 'decal') return false;
    if (object.type === 'prop') return true;
    if (object.type !== 'entity') return false;
    return Boolean(modelPath(object) || object.ephMeshEntity || object.ephMeshChildIds?.length);
  }

  function rootIdForHit(vp, hitObject) {
    if (!vp || !hitObject) return null;
    const ids = new Map();
    for (const [id, root] of vp.objectRoots || []) ids.set(root, id);
    let node = hitObject;
    while (node) {
      if (ids.has(node)) return ids.get(node);
      if (node === vp.objectGroup) break;
      node = node.parent;
    }
    return null;
  }

  function modelHit(excludeId = null) {
    const vp = viewport();
    const T = THREE();
    if (!vp?.camera || !vp?.raycaster || !T) return null;

    const roots = [];
    for (const [id, root] of vp.objectRoots || []) {
      if (id === excludeId || !root?.visible || !isModelSurface(objectById(id))) continue;
      roots.push(root);
    }
    if (!roots.length) return null;

    vp.raycaster.setFromCamera(new T.Vector2(0, 0), vp.camera);
    const hits = vp.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (!hit?.point || !hit?.object) continue;
      if (hit.object.userData?.ephSelectionHighlight || hit.object.userData?.ephTransformGizmo) continue;
      const targetId = rootIdForHit(vp, hit.object);
      const target = objectById(targetId);
      if (!target || !isModelSurface(target)) continue;

      let normal = null;
      if (hit.face?.normal) {
        normal = hit.face.normal.clone();
        try { normal.applyMatrix3(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize(); } catch {}
      }
      if (!normal || normal.lengthSq() < 1e-8) {
        normal = vp.camera.getWorldDirection(new T.Vector3()).multiplyScalar(-1).normalize();
      }
      return { point: hit.point.clone(), normal, targetId, distance: hit.distance };
    }
    return null;
  }

  function writePosition(object, hit) {
    const s = state();
    const vp = viewport();
    if (!object || !hit?.point || !hit?.normal || !s) return false;
    const position = hit.point.clone().addScaledVector(hit.normal, OFFSET);
    object.position = [position.x, position.y, position.z];
    VMAP?.applyObjectToDocument?.(s.doc, object);
    vp?.updateObject?.(object);
    if (s.selectedId === object.id) vp?.select?.(object.id, false);
    return true;
  }

  function snapCreatedEntity(object) {
    if (!object || object.type !== 'entity') return false;
    const first = modelHit(object.id);
    if (!first) return false;
    writePosition(object, first);

    // A prop/model can still be swapping its temporary preview for the decoded
    // Source 2 model. Re-sample the exact triangles briefly so the entity ends
    // up on the real model surface instead of remaining on the preview box.
    const targetId = first.targetId;
    for (const delay of [70, 180, 420, 900]) {
      setTimeout(() => {
        if (!(state()?.objects || []).includes(object)) return;
        const next = modelHit(object.id);
        if (!next || next.targetId !== targetId) return;
        writePosition(object, next);
      }, delay);
    }

    try {
      renderTree?.();
      renderProperties?.();
      console.info('[Entity Model Placement V57] Entity placed on model surface.', {
        entity: object.className || object.name || object.id,
        target: objectById(targetId)?.name || objectById(targetId)?.model || targetId,
        position: object.position,
      });
    } catch {}
    return true;
  }

  function createdAfter(before) {
    const s = state();
    const selected = objectById(s?.selectedId);
    if (selected?.type === 'entity' && !before.has(selected.id)) return selected;
    return (s?.objects || []).find(object => object?.type === 'entity' && object.id && !before.has(object.id)) || null;
  }

  function installAddEntity() {
    let current = null;
    try { current = addEntity; } catch { current = window.addEntity; }
    if (typeof current !== 'function') return false;
    if (current.__ephEntityModelPlacementV57) {
      wrappedAddEntity = current;
      return true;
    }

    const previous = current;
    const wrapped = function(...args) {
      const before = new Set((state()?.objects || []).map(object => object?.id));
      const result = previous.apply(this, args);
      const finish = resolved => {
        const object = (resolved && typeof resolved === 'object' && resolved.type === 'entity' ? resolved : null) || createdAfter(before);
        if (object) snapCreatedEntity(object);
        return resolved;
      };
      if (result?.then) return result.then(finish);
      finish(result);
      return result;
    };

    for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
    wrapped.__ephEntityModelPlacementV57 = true;
    wrapped.__ephPrevious = previous;
    try { addEntity = wrapped; } catch {}
    window.addEntity = wrapped;
    wrappedAddEntity = wrapped;
    return true;
  }

  function install() {
    installAddEntity();
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', () => queueMicrotask(install));
  window.addEventListener('eph-runtime-ready', () => queueMicrotask(install), { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    let current = null;
    try { current = addEntity; } catch { current = window.addEntity; }
    if (current !== wrappedAddEntity) installAddEntity();
    if (checks >= 24) clearInterval(guard);
  }, 250);

  window.EPH_ENTITY_MODEL_PLACEMENT_V57 = {
    install,
    hit: modelHit,
    snap: snapCreatedEntity,
  };

  console.info('[Entity Model Placement V57] Entities can be placed directly on prop and model-backed entity surfaces.');
})();
