// byanca
(() => {
  'use strict';
  if (window.__ephNegativeBrushWallPreserveV23) return;
  window.__ephNegativeBrushWallPreserveV23 = true;

  const EPSILON = 1e-5;
  const ROUND = 100000;
  const RAD = Math.PI / 180;
  let installed = false;

  const THREE = () => window.EPH_THREE || window.THREE;
  const round = value => Math.round(Number(value || 0) * ROUND) / ROUND;
  const clone = value => {
    try { return structuredClone(value); }
    catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
  };

  function matrixFor(object) {
    const T = THREE();
    const position = new T.Vector3(...(object.position || [0, 0, 0]).map(Number));
    const rotation = object.rotation || [0, 0, 0];
    let quaternion = window.EPH_COORDINATES?.qAngleToQuaternion?.(rotation) || null;
    if (!quaternion) {
      const pitch = (Number(rotation[0]) || 0) * RAD;
      const yaw = (Number(rotation[1]) || 0) * RAD;
      const roll = (Number(rotation[2]) || 0) * RAD;
      const qYaw = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), yaw);
      const qPitch = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), pitch);
      const qRoll = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), roll);
      quaternion = qYaw.multiply(qPitch).multiply(qRoll).normalize();
    }
    const scale = new T.Vector3(...(object.scale || [1, 1, 1]).map(value => Number.isFinite(Number(value)) ? Number(value) : 1));
    return new T.Matrix4().compose(position, quaternion, scale);
  }

  function boundsForVertices(vertices) {
    const T = THREE();
    const box = new T.Box3();
    for (const vertex of vertices || []) box.expandByPoint(new T.Vector3(...vertex));
    return box;
  }

  function orientedLocalFace(object, face) {
    const T = THREE();
    const points = (face || []).map(index => new T.Vector3(...(object.vertices?.[index] || [0, 0, 0])));
    if (points.length < 3) return points;
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (normal.lengthSq() < EPSILON * EPSILON) return points;
    const faceCenter = points.reduce((sum, point) => sum.add(point), new T.Vector3()).multiplyScalar(1 / points.length);
    const center = boundsForVertices(object.vertices || []).getCenter(new T.Vector3());
    if (normal.dot(faceCenter.clone().sub(center)) < 0) points.reverse();
    return points;
  }

  function clipAgainstAxis(points, axis, boundary, keepGreater) {
    if (!points.length) return [];
    const output = [];
    const inside = point => keepGreater ? point.getComponent(axis) >= boundary - EPSILON : point.getComponent(axis) <= boundary + EPSILON;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const aInside = inside(a);
      const bInside = inside(b);
      if (aInside) output.push(a.clone());
      if (aInside === bInside) continue;
      const av = a.getComponent(axis);
      const bv = b.getComponent(axis);
      const denominator = bv - av;
      if (Math.abs(denominator) < EPSILON) continue;
      const t = Math.max(0, Math.min(1, (boundary - av) / denominator));
      output.push(a.clone().lerp(b, t));
    }
    return output;
  }

  function clipToBounds(points, bounds) {
    let clipped = points.map(point => point.clone());
    for (let axis = 0; axis < 3 && clipped.length >= 3; axis++) {
      clipped = clipAgainstAxis(clipped, axis, bounds.min.getComponent(axis), true);
      if (clipped.length < 3) break;
      clipped = clipAgainstAxis(clipped, axis, bounds.max.getComponent(axis), false);
    }
    return clipped;
  }

  function triangleKey(points) {
    return points.map(point => `${round(point.x)},${round(point.y)},${round(point.z)}`).sort().join('|');
  }

  function existingTriangleKeys(object) {
    const T = THREE();
    const keys = new Set();
    for (const face of object.faces || []) {
      if (!Array.isArray(face) || face.length < 3) continue;
      const points = face.map(index => new T.Vector3(...(object.vertices?.[index] || [0, 0, 0])));
      for (let i = 1; i < points.length - 1; i++) keys.add(triangleKey([points[0], points[i], points[i + 1]]));
    }
    return keys;
  }

  function appendCavityShell(target, targetBefore, cutter) {
    const T = THREE();
    if (!T || !target?.vertices || !target?.faces || !cutter?.vertices || !cutter?.faces) return 0;

    const targetMatrix = matrixFor(targetBefore);
    const inverseTarget = targetMatrix.clone().invert();
    const cutterMatrix = matrixFor(cutter);
    const originalBounds = boundsForVertices(targetBefore.vertices || []);
    if (originalBounds.isEmpty()) return 0;

    const existing = existingTriangleKeys(target);
    const indexByKey = new Map();
    for (let index = 0; index < target.vertices.length; index++) {
      const vertex = target.vertices[index];
      indexByKey.set(`${round(vertex[0])},${round(vertex[1])},${round(vertex[2])}`, index);
    }
    const vertexIndex = point => {
      const key = `${round(point.x)},${round(point.y)},${round(point.z)}`;
      if (indexByKey.has(key)) return indexByKey.get(key);
      const index = target.vertices.length;
      target.vertices.push([point.x, point.y, point.z]);
      indexByKey.set(key, index);
      return index;
    };

    const worldUp = new T.Vector3(0, 0, 1);
    const material = targetBefore.faceMaterials?.[0] || target.faceMaterials?.[0] || 'ERROR';
    let added = 0;

    for (const face of cutter.faces || []) {
      const local = orientedLocalFace(cutter, face);
      if (local.length < 3) continue;
      const world = local.map(point => point.clone().applyMatrix4(cutterMatrix));
      const worldNormal = world[1].clone().sub(world[0]).cross(world[2].clone().sub(world[0]));
      if (worldNormal.lengthSq() < EPSILON * EPSILON) continue;
      worldNormal.normalize();

      // The upward-facing cutter cap is the opening. Keep the side walls and
      // lower cap so a recessed carve remains a closed, visible cavity.
      if (worldNormal.dot(worldUp) > 0.75) continue;

      // Cutter faces point out of the cutter. The cavity surface must face the
      // opposite way: into the empty carved volume.
      let targetLocal = world.map(point => point.clone().applyMatrix4(inverseTarget)).reverse();
      targetLocal = clipToBounds(targetLocal, originalBounds);
      if (targetLocal.length < 3) continue;

      for (let i = 1; i < targetLocal.length - 1; i++) {
        const triangle = [targetLocal[0], targetLocal[i], targetLocal[i + 1]];
        const key = triangleKey(triangle);
        if (existing.has(key)) continue;
        const indices = triangle.map(vertexIndex);
        if (new Set(indices).size < 3) continue;
        target.faces.push(indices);
        target.faceMaterials ||= [];
        target.faceMaterials.push(material);
        existing.add(key);
        added++;
      }
    }

    if (!added) return 0;
    target.size = window.EPH_VMAP?.geometryBounds?.(target.vertices)?.size || target.size;
    target.materials ||= {};
    window.EPH_VMAP?.FACE_NAMES?.forEach((name, index) => {
      target.materials[name] = target.faceMaterials?.[index] || target.faceMaterials?.[0] || material;
    });
    delete target.faceUVs;
    delete target.faceTextureScale;
    delete target.faceTextureAxisU;
    delete target.faceTextureAxisV;
    delete target.faceTextureSizes;
    window.EPH_VMAP?.applyObjectToDocument?.(S.doc, target);
    S.viewport?.updateObject?.(target);
    return added;
  }

  function selectedParts() {
    try { return window.EPH_NEGATIVE_BRUSH?.selectedParts?.() || []; }
    catch { return []; }
  }

  function install() {
    const runtime = window.EPH_NEGATIVE_BRUSH;
    if (installed || !runtime?.carve) return installed;
    const rawCarve = runtime.carve;

    runtime.carve = function() {
      const parts = selectedParts();
      const negative = parts.find(part => part?.type === 'part' && part.ephNegative);
      const normals = parts.filter(part => part?.type === 'part' && !part.ephNegative);
      if (!negative || !normals.length) return rawCarve();

      const cutterSnapshot = clone(negative);
      const normalSnapshots = new Map(normals.map(part => [part.id, clone(part)]));
      const result = rawCarve();
      if (!result) return result;

      let totalAdded = 0;
      for (const [id, before] of normalSnapshots) {
        const target = S?.objects?.find(object => object?.id === id && object?.type === 'part');
        if (!target) continue;
        totalAdded += appendCavityShell(target, before, cutterSnapshot);
      }

      if (totalAdded > 0) {
        try { renderAll?.(); } catch {}
        try { markDirty?.(`Preserved ${totalAdded} cavity wall face${totalAdded === 1 ? '' : 's'}`); } catch {}
        try { console.info('[Negative Brush Wall Preserve V23] Preserved carved cavity walls.', { faces: totalAdded }); } catch {}
      }
      return result;
    };

    runtime.carve.__ephWallPreserveV23 = true;
    installed = true;
    console.info('[Negative Brush Wall Preserve V23] Installed.');
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
    setTimeout(() => clearInterval(timer), 30000);
  }
})();
