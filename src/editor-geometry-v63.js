// byanca
(() => {
  'use strict';
  if (window.__ephEditorGeometryV63) return;
  window.__ephEditorGeometryV63 = true;

  const VMAP = window.EPH_VMAP;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewport = () => window.EPH3D || state()?.viewport || null;
  const THREE = () => window.EPH_THREE || window.THREE;
  const objectById = id => state()?.objects?.find(object => object?.id === id) || null;
  const CONTACT = 0.12;
  const SCALE_STORAGE_MODE = 'eph-scale-anchor-v21';
  const SCALE_STORAGE_STEP = 'eph-scale-step-v21';
  const SCALE_MIN = 0.01;

  let surfaceSession = null;
  let surfaceInstalled = null;
  let scaleInstalled = false;
  let scaleGroup = null;
  let scaleHandles = [];
  let scaleDrag = null;
  let transformWasEnabled = true;

  function surfaceEnabled(vp = viewport()) {
    try {
      if (window.EPH_SURFACE_MOVE_V39?.enabled) return window.EPH_SURFACE_MOVE_V39.enabled() !== false;
    } catch {}
    return vp?.surfaceSnap !== false;
  }

  function selectedIds(vp = viewport()) {
    const ids = [];
    const add = id => {
      if (!id || ids.includes(id)) return;
      const object = objectById(id);
      if (!object || ['world', 'folder'].includes(object.type) || object.visible === false) return;
      ids.push(id);
    };
    try { for (const id of window.EPH_MULTI_SELECTION?.ids?.() || []) add(id); } catch {}
    for (const id of state()?.multiSelectedIds || []) add(id);
    for (const id of vp?.multiSelectedIds || []) add(id);
    add(vp?.selectedId || state()?.selectedId);
    return ids;
  }

  function surfaceCandidate(object) {
    if (!object || object.visible === false || object.ephNegative || object.type === 'decal') return false;
    if (['part', 'terrain', 'prop'].includes(object.type)) return true;
    if (object.type !== 'entity') return false;
    return Boolean(
      object.ephMeshEntity
      || object.ephMeshChildIds?.length
      || object.model
      || object.entityProperties?.model
      || object.entityProperties?.modelname
      || object.entityProperties?.worldmodel
    );
  }

  function excludedSurfaceIds(vp) {
    const excluded = new Set();
    for (const id of selectedIds(vp)) {
      excluded.add(id);
      const object = objectById(id);
      for (const childId of object?.ephMeshChildIds || []) excluded.add(childId);
      for (const candidate of state()?.objects || []) if (candidate?.parent === id && candidate?.ephMeshEntityChild) excluded.add(candidate.id);
    }
    return excluded;
  }

  function activeMoveRoot(vp) {
    if (vp?.transform?.object) return vp.transform.object;
    const id = vp?.selectedId || state()?.selectedId;
    if (!id) return null;
    const direct = vp.objectRoots?.get?.(id);
    if (direct) return direct;
    const object = objectById(id);
    for (const childId of object?.ephMeshChildIds || []) {
      const root = vp.objectRoots?.get?.(childId);
      if (root) return root;
    }
    return null;
  }

  function nearbySurfaceRoots(vp, excludeIds, sweptBox) {
    const T = THREE();
    if (!T) return [];
    const roots = [];
    for (const [id, root] of vp?.objectRoots || []) {
      if (excludeIds.has(id) || !root?.visible || !surfaceCandidate(objectById(id))) continue;
      try {
        root.updateWorldMatrix?.(true, true);
        const box = new T.Box3().setFromObject(root);
        if (!box.isEmpty() && box.intersectsBox(sweptBox)) roots.push(root);
      } catch {
        roots.push(root);
      }
    }
    return roots;
  }

  function denseFaceSamples(box, direction) {
    const T = THREE();
    if (!T || !box || box.isEmpty()) return [];
    const min = box.min;
    const max = box.max;
    const mid = min.clone().add(max).multiplyScalar(0.5);
    const extent = max.clone().sub(min);
    const abs = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
    const largest = Math.max(...abs);
    const samples = [];

    const addFace = axis => {
      const fixed = direction.getComponent(axis) >= 0 ? max.getComponent(axis) : min.getComponent(axis);
      const a = (axis + 1) % 3;
      const b = (axis + 2) % 3;
      const countA = Math.max(5, Math.min(9, Math.ceil(extent.getComponent(a) / 24) + 1));
      const countB = Math.max(5, Math.min(9, Math.ceil(extent.getComponent(b) / 24) + 1));
      for (let ia = 0; ia < countA; ia++) {
        const ta = countA === 1 ? 0.5 : ia / (countA - 1);
        const va = min.getComponent(a) + (max.getComponent(a) - min.getComponent(a)) * ta;
        for (let ib = 0; ib < countB; ib++) {
          const tb = countB === 1 ? 0.5 : ib / (countB - 1);
          const vb = min.getComponent(b) + (max.getComponent(b) - min.getComponent(b)) * tb;
          const point = mid.clone();
          point.setComponent(axis, fixed);
          point.setComponent(a, va);
          point.setComponent(b, vb);
          samples.push(point);
        }
      }
    };

    for (let axis = 0; axis < 3; axis++) {
      if (abs[axis] >= Math.max(0.05, largest * 0.2)) addFace(axis);
    }
    if (!samples.length) addFace(abs.indexOf(largest));
    return samples;
  }

  function worldHitNormal(hit, fallbackDirection) {
    const T = THREE();
    if (!T) return null;
    let normal = null;
    if (hit?.face?.normal) {
      normal = hit.face.normal.clone();
      try { normal.applyMatrix3(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize(); } catch {}
    }
    if (!normal || normal.lengthSq() < 1e-8) normal = fallbackDirection.clone().multiplyScalar(-1).normalize();
    if (normal.dot(fallbackDirection) > 0) normal.multiplyScalar(-1);
    return normal;
  }

  function clampAgainstBarrier(session, candidate) {
    const barrier = session?.barrier;
    if (!barrier) return null;
    const displacement = candidate.clone().sub(barrier.position);
    const into = displacement.dot(barrier.normal);
    if (into > CONTACT * 3) {
      session.barrier = null;
      return null;
    }
    if (into >= -CONTACT * 0.15) return null;
    return candidate.clone().addScaledVector(barrier.normal, -into);
  }

  function sweptSurfaceClamp(vp, session, candidate) {
    const T = THREE();
    if (!T || !session?.root) return null;

    const barrierClamp = clampAgainstBarrier(session, candidate);
    if (barrierClamp) return barrierClamp;

    const delta = candidate.clone().sub(session.lastPosition);
    const distance = delta.length();
    if (distance < 1e-7) return null;
    const direction = delta.clone().multiplyScalar(1 / distance);

    const sweptBox = session.lastBox.clone();
    const movedBox = session.lastBox.clone().translate(delta);
    sweptBox.union(movedBox).expandByScalar(CONTACT * 4);
    const roots = nearbySurfaceRoots(vp, session.excludeIds, sweptBox);
    if (!roots.length) return null;

    const samples = denseFaceSamples(session.lastBox, direction);
    if (!samples.length) return null;
    const oldNear = vp.raycaster.near;
    const oldFar = vp.raycaster.far;
    let nearest = null;
    try {
      vp.raycaster.near = 0;
      vp.raycaster.far = distance + CONTACT * 5;
      for (const sample of samples) {
        const origin = sample.clone().addScaledVector(direction, -CONTACT * 0.35);
        vp.raycaster.set(origin, direction);
        vp.raycaster.far = distance + CONTACT * 5;
        const hit = vp.raycaster.intersectObjects(roots, true)[0];
        if (!hit || !Number.isFinite(hit.distance)) continue;
        if (!nearest || hit.distance < nearest.distance) nearest = hit;
      }
    } finally {
      vp.raycaster.near = oldNear;
      vp.raycaster.far = oldFar;
    }

    if (!nearest || nearest.distance > distance + CONTACT) return null;
    const safeDistance = Math.max(0, nearest.distance - CONTACT);
    const safe = session.lastPosition.clone().addScaledVector(direction, Math.min(distance, safeDistance));
    const normal = worldHitNormal(nearest, direction);
    if (normal) session.barrier = { position: safe.clone(), normal };
    return safe;
  }

  function beginSurfaceMove(vp) {
    surfaceSession = null;
    if (!vp || vp.tool !== 'move' || !surfaceEnabled(vp)) return;
    const T = THREE();
    const root = activeMoveRoot(vp);
    if (!T || !root) return;
    root.updateWorldMatrix?.(true, true);
    const box = new T.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    surfaceSession = {
      vp,
      root,
      lastPosition: root.position.clone(),
      lastBox: box.clone(),
      excludeIds: excludedSurfaceIds(vp),
      barrier: null,
      correcting: false,
    };
  }

  function updateSurfaceMove() {
    const session = surfaceSession;
    const vp = session?.vp;
    if (!session || !vp || session.correcting || vp.tool !== 'move' || !surfaceEnabled(vp) || vp.transform?.object !== session.root) return;

    const candidate = session.root.position.clone();
    const corrected = sweptSurfaceClamp(vp, session, candidate);
    if (corrected && corrected.distanceToSquared(candidate) > 1e-10) {
      session.root.position.copy(corrected);
      session.root.updateMatrixWorld?.(true);
      session.correcting = true;
      try {
        vp.syncSelectedFromRoot?.(false);
        vp.updateSelectionBox?.();
      } finally {
        session.correcting = false;
      }
    }

    session.root.updateWorldMatrix?.(true, true);
    session.lastPosition.copy(session.root.position);
    session.lastBox.setFromObject(session.root);
  }

  function installSurfaceHardening(vp = viewport()) {
    if (!vp?.transform || surfaceInstalled === vp) return false;
    surfaceInstalled = vp;
    vp.transform.addEventListener('dragging-changed', event => {
      if (event.value) beginSurfaceMove(vp);
      else surfaceSession = null;
    });
    vp.transform.addEventListener('objectChange', updateSurfaceMove);
    return true;
  }

  function scaleMode() { return localStorage.getItem(SCALE_STORAGE_MODE) === 'both' ? 'both' : 'one'; }
  function scaleStep() {
    const raw = localStorage.getItem(SCALE_STORAGE_STEP) || 'grid';
    if (raw === 'grid') return Math.max(1, Number(state()?.gridSize) || 64);
    return Math.max(0.0001, Number(raw) || 1);
  }

  function geometryBounds(vertices) {
    return VMAP?.geometryBounds?.(vertices || []) || { center: [0, 0, 0], size: [64, 64, 64] };
  }

  function selectedPart(vp = viewport()) {
    const ids = selectedIds(vp);
    if (ids.length !== 1) return null;
    const object = objectById(ids[0]);
    return object?.type === 'part' ? object : null;
  }

  function disposeScaleGroup() {
    if (!scaleGroup) return;
    scaleGroup.parent?.remove?.(scaleGroup);
    scaleGroup.traverse?.(node => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.());
      else node.material?.dispose?.();
    });
    scaleGroup = null;
    scaleHandles = [];
  }

  function createScaleGroup(vp) {
    const T = THREE();
    if (!T || !vp?.scene) return null;
    disposeScaleGroup();
    const group = new T.Group();
    group.name = 'EPH_FaceScaleGizmoV63';
    group.userData.ephTransformGizmo = true;
    group.renderOrder = 12000;
    const colors = [0xff3131, 0x35db55, 0x315dfe];

    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [-1, 1]) {
        const material = new T.MeshBasicMaterial({ color: colors[axis], depthTest: false, depthWrite: false });
        const pickerMaterial = new T.MeshBasicMaterial({ color: colors[axis], transparent: true, opacity: 0.001, depthTest: false, depthWrite: false });
        const lineMaterial = new T.LineBasicMaterial({ color: colors[axis], depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
        const handle = new T.Mesh(new T.BoxGeometry(1, 1, 1), material);
        const picker = new T.Mesh(new T.BoxGeometry(1, 1, 1), pickerMaterial);
        const lineGeometry = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
        const line = new T.Line(lineGeometry, lineMaterial);
        const data = { axis, sign, handle, picker, line, center: new T.Vector3(), face: new T.Vector3(), axisWorld: new T.Vector3() };
        handle.userData.ephScaleFaceV63 = data;
        picker.userData.ephScaleFaceV63 = data;
        handle.userData.ephTransformGizmo = true;
        picker.userData.ephTransformGizmo = true;
        line.userData.ephTransformGizmo = true;
        handle.renderOrder = picker.renderOrder = line.renderOrder = 12001;
        group.add(line, handle, picker);
        scaleHandles.push(data);
      }
    }

    vp.scene.add(group);
    scaleGroup = group;
    return group;
  }

  function screenHandleSize(vp, worldPoint) {
    const distance = vp.camera.position.distanceTo(worldPoint);
    return Math.max(2.5, Math.min(14, distance * 0.012));
  }

  function updateFaceScaleGizmo(vp = viewport()) {
    const T = THREE();
    const part = selectedPart(vp);
    const active = Boolean(T && vp?.tool === 'scale' && part && vp.objectRoots?.get(part.id));
    const helper = vp?.transform?.getHelper?.();

    if (!active) {
      if (scaleGroup) scaleGroup.visible = false;
      if (vp?.transform) {
        vp.transform.enabled = transformWasEnabled;
        if (helper) helper.visible = true;
      }
      return false;
    }

    if (!scaleGroup) createScaleGroup(vp);
    if (!scaleGroup) return false;
    scaleGroup.visible = true;

    if (vp.transform) {
      transformWasEnabled = vp.transform.enabled !== false || transformWasEnabled;
      vp.transform.enabled = false;
      if (helper) helper.visible = false;
    }

    const root = vp.objectRoots.get(part.id);
    const b = geometryBounds(part.vertices);
    const centerLocal = new T.Vector3(...b.center);
    const centerWorld = root.localToWorld(centerLocal.clone());
    const quaternion = root.getWorldQuaternion(new T.Quaternion());

    for (const data of scaleHandles) {
      const local = centerLocal.clone();
      local.setComponent(data.axis, local.getComponent(data.axis) + data.sign * Math.max(SCALE_MIN, Number(b.size[data.axis]) || 0) * 0.5);
      const faceWorld = root.localToWorld(local);
      const axisWorld = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)][data.axis].applyQuaternion(quaternion).normalize();
      const size = screenHandleSize(vp, faceWorld);

      data.center.copy(centerWorld);
      data.face.copy(faceWorld);
      data.axisWorld.copy(axisWorld);
      data.handle.position.copy(faceWorld);
      data.handle.scale.setScalar(size);
      data.picker.position.copy(faceWorld);
      data.picker.scale.setScalar(size * 2.4);

      const positions = data.line.geometry.attributes.position;
      positions.setXYZ(0, centerWorld.x, centerWorld.y, centerWorld.z);
      positions.setXYZ(1, faceWorld.x, faceWorld.y, faceWorld.z);
      positions.needsUpdate = true;
      data.line.geometry.computeBoundingSphere?.();
    }
    return true;
  }

  function raycastScaleHandle(event, vp = viewport()) {
    if (!scaleGroup?.visible || !vp?.renderer?.domElement) return null;
    const canvas = vp.renderer.domElement;
    if (!(event.target === canvas || event.composedPath?.().includes(canvas))) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    vp.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    vp.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    vp.raycaster.setFromCamera(vp.pointer, vp.camera);
    const hit = vp.raycaster.intersectObjects(scaleHandles.map(item => item.picker), false)[0];
    return hit?.object?.userData?.ephScaleFaceV63 || null;
  }

  function project(vp, point) {
    const rect = vp.renderer.domElement.getBoundingClientRect();
    const p = point.clone().project(vp.camera);
    return { x: rect.left + (p.x + 1) * rect.width * 0.5, y: rect.top + (1 - p.y) * rect.height * 0.5 };
  }

  function beginScaleDrag(event, handle, vp = viewport()) {
    const T = THREE();
    const part = selectedPart(vp);
    const root = part && vp?.objectRoots?.get(part.id);
    if (!T || !part || !root || !handle) return false;

    const b = geometryBounds(part.vertices);
    const centerWorld = handle.center.clone();
    const reference = centerWorld.clone().addScaledVector(handle.axisWorld, 128);
    const a = project(vp, centerWorld);
    const bScreen = project(vp, reference);
    const dx = bScreen.x - a.x;
    const dy = bScreen.y - a.y;
    const pixels = Math.hypot(dx, dy);
    if (!Number.isFinite(pixels) || pixels < 1.5) return false;

    scaleDrag = {
      vp,
      partId: part.id,
      root,
      axis: handle.axis,
      sign: handle.sign,
      startX: event.clientX,
      startY: event.clientY,
      ux: dx / pixels,
      uy: dy / pixels,
      worldPerPixel: Math.max(0.001, Math.min(8, 128 / pixels)),
      baseVertices: (part.vertices || []).map(v => [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]),
      baseSize: [...b.size],
      center: [...b.center],
      startPosition: root.position.clone(),
      axisWorld: handle.axisWorld.clone(),
      targetSize: [...b.size],
      factors: [1, 1, 1],
      changed: false,
      historyPushed: false,
    };
    return true;
  }

  function snappedScaleSize(base, raw) {
    const step = scaleStep();
    return Math.max(SCALE_MIN, base + Math.round((raw - base) / step) * step);
  }

  function updateScaleDrag(event) {
    const drag = scaleDrag;
    if (!drag) return;
    const part = objectById(drag.partId);
    if (!part || !drag.root?.parent) { scaleDrag = null; return; }

    const px = event.clientX - drag.startX;
    const py = event.clientY - drag.startY;
    const projected = px * drag.ux + py * drag.uy;
    const outward = projected * drag.sign * drag.worldPerPixel;
    const rawSize = drag.baseSize[drag.axis] + outward;
    const target = snappedScaleSize(drag.baseSize[drag.axis], rawSize);
    const factor = target / Math.max(SCALE_MIN, drag.baseSize[drag.axis]);
    if (Math.abs(target - drag.targetSize[drag.axis]) < 1e-7) return;

    if (!drag.historyPushed) {
      try { pushHistory?.(); } catch {}
      drag.historyPushed = true;
    }
    drag.changed = true;
    drag.targetSize = [...drag.baseSize];
    drag.targetSize[drag.axis] = target;
    drag.factors = [1, 1, 1];
    drag.factors[drag.axis] = factor;
    drag.root.scale.set(...drag.factors);
    drag.root.position.copy(drag.startPosition);

    if (scaleMode() === 'one') {
      const shift = (target - drag.baseSize[drag.axis]) * 0.5 * drag.sign;
      drag.root.position.addScaledVector(drag.axisWorld, shift);
    }

    drag.root.updateMatrixWorld?.(true);
    drag.vp.updateSelectionBox?.();
    updateFaceScaleGizmo(drag.vp);
  }

  function commitScaleDrag() {
    const drag = scaleDrag;
    scaleDrag = null;
    if (!drag) return;
    const part = objectById(drag.partId);
    const root = drag.root;
    if (!part || !root) return;

    if (!drag.changed) {
      root.scale.set(1, 1, 1);
      root.position.copy(drag.startPosition);
      return;
    }

    const c = drag.center;
    part.vertices = drag.baseVertices.map(vertex => vertex.map((value, axis) => c[axis] + (value - c[axis]) * drag.factors[axis]));
    part.position = [root.position.x, root.position.y, root.position.z];
    part.scale = [1, 1, 1];
    part.size = geometryBounds(part.vertices).size;
    root.scale.set(1, 1, 1);
    root.position.set(...part.position);
    VMAP?.applyObjectToDocument?.(state()?.doc, part);
    drag.vp.callbacks?.change?.(part, true);
    drag.vp.updateObject?.(part);
    try { markDirty?.(`Scaled ${part.name || part.id}`); } catch {}
    try { renderProperties?.(); } catch {}
    requestAnimationFrame(() => updateFaceScaleGizmo(drag.vp));
  }

  function installScaleFaceControls() {
    if (scaleInstalled) return;
    scaleInstalled = true;

    window.addEventListener('pointerdown', event => {
      if (event.button !== 0 || scaleDrag) return;
      const vp = viewport();
      if (vp?.tool !== 'scale') return;
      updateFaceScaleGizmo(vp);
      const handle = raycastScaleHandle(event, vp);
      if (!handle || !beginScaleDrag(event, handle, vp)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    window.addEventListener('pointermove', event => {
      if (!scaleDrag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      updateScaleDrag(event);
    }, true);

    const finish = event => {
      if (!scaleDrag) return;
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      commitScaleDrag();
    };
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', () => commitScaleDrag(), true);

    const tick = () => {
      updateFaceScaleGizmo();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function install(vp = viewport()) {
    installSurfaceHardening(vp);
    installScaleFaceControls();
    updateFaceScaleGizmo(vp);
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  window.EPH_EDITOR_GEOMETRY_V63 = {
    install,
    updateScaleGizmo: updateFaceScaleGizmo,
    surfaceSession: () => surfaceSession,
  };

  console.info('[Editor Geometry V63] Continuous surface barriers and face-anchored Part scale handles installed.');
})();