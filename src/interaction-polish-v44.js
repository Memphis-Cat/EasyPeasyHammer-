// byanca
(() => {
  'use strict';
  if (window.__ephInteractionPolishV44) return;
  window.__ephInteractionPolishV44 = true;

  const VMAP = window.EPH_VMAP;
  const DEFAULT_DECAL_MATERIAL = 'materials/dev/dev_measuregeneric01b.vmat';
  const DECAL_OFFSET = 0.06;
  const PICK_RADIUS_PX = 8;
  let installedViewport = null;
  let mirrorGroup = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;

  function report(message, meta = null) {
    console.info(`[Interaction Polish V44] ${message}`, meta || '');
    try { window.easyPeasyHammer?.appLog?.('normal', 'interaction-polish-v44', message, meta)?.catch?.(() => {}); } catch {}
  }

  function ensureStyle() {
    if (document.getElementById('ephInteractionPolishV44Style')) return;
    const style = document.createElement('style');
    style.id = 'ephInteractionPolishV44Style';
    style.textContent = '#ephCsgUndoTop{display:none!important}';
    document.head.appendChild(style);
  }

  function removeTopCsgUndo() {
    document.getElementById('ephCsgUndoTop')?.remove();
  }

  function objectById(id) {
    return (state()?.objects || []).find(object => object?.id === id) || null;
  }

  function surfaceCandidate(object) {
    if (!object || object.visible === false || object.ephNegative || object.type === 'decal') return false;
    if (['part', 'terrain', 'prop'].includes(object.type)) return true;
    return object.type === 'entity' && Boolean(object.ephMeshEntity || object.ephMeshChildIds?.length);
  }

  function centerSurfaceHit(viewport) {
    const existing = window.EPH_POV_PLACEMENT_V41?.centerRay?.();
    if (existing?.point && existing?.normal) return existing;

    const T = THREE();
    if (!T || !viewport?.camera || !viewport?.raycaster) return null;
    viewport.raycaster.setFromCamera(new T.Vector2(0, 0), viewport.camera);
    const roots = [];
    for (const [id, root] of viewport.objectRoots || []) {
      if (!root?.visible || !surfaceCandidate(objectById(id))) continue;
      roots.push(root);
    }
    if (!roots.length) return null;

    const hits = viewport.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (!hit?.point || !hit?.object) continue;
      let normal = null;
      if (hit.face?.normal) {
        normal = hit.face.normal.clone();
        const normalMatrix = new T.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        normal.applyMatrix3(normalMatrix).normalize();
      }
      if (!normal || normal.lengthSq() < 1e-8) normal = viewport.camera.getWorldDirection(new T.Vector3()).multiplyScalar(-1).normalize();
      return { point: hit.point.clone(), normal, object: hit.object, distance: hit.distance };
    }
    return null;
  }

  function makePlane(width = 128, height = 128) {
    const w = Math.max(.1, Number(width) || 128) / 2;
    const h = Math.max(.1, Number(height) || 128) / 2;
    return {
      vertices: [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]],
      faces: [[0, 1, 2, 3]],
    };
  }

  function rotationForNormal(normal) {
    const T = THREE();
    const direction = normal.clone().normalize();
    const quaternion = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
    const euler = new T.Euler().setFromQuaternion(quaternion, 'XYZ');
    const degrees = 180 / Math.PI;
    return [euler.x * degrees, euler.y * degrees, euler.z * degrees];
  }

  function nextDecalName() {
    let highest = 0;
    for (const object of state()?.objects || []) {
      const match = String(object?.name || '').match(/^Decal[_\s-]*(\d+)$/i);
      if (match) highest = Math.max(highest, Number(match[1]) || 0);
    }
    return `Decal_${String(highest + 1).padStart(3, '0')}`;
  }

  function createDecalAtViewCenter() {
    const s = state();
    const viewport = s?.viewport || window.EPH3D;
    const T = THREE();
    if (!s?.doc || !viewport || !T || !VMAP?.addPart) return false;

    const hit = centerSurfaceHit(viewport);
    if (!hit) {
      toast?.('No surface in the center of view for the decal.');
      return false;
    }

    pushHistory?.();
    const geometry = makePlane(128, 128);
    const position = hit.point.clone().addScaledVector(hit.normal, DECAL_OFFSET);
    const object = ensureObject(VMAP.addPart(s.doc, {
      ...geometry,
      position: position.toArray(),
      rotation: rotationForNormal(hit.normal),
      scale: [1, 1, 1],
      faceMaterials: [DEFAULT_DECAL_MATERIAL],
      material: DEFAULT_DECAL_MATERIAL,
      collision: false,
      meshName: `EPH_DECAL_${Date.now()}`,
    }));

    if (!object) {
      s.undo?.pop?.();
      toast?.('Could not create decal.');
      return false;
    }

    object.type = 'decal';
    object.name = nextDecalName();
    object.collision = false;
    object.blockPlayers = false;
    object.blockGrenades = false;
    object.blockBullets = false;
    object.faceMaterials = [DEFAULT_DECAL_MATERIAL];
    object.materials = Object.fromEntries((VMAP.FACE_NAMES || []).map(name => [name, DEFAULT_DECAL_MATERIAL]));

    s.objects.push(object);
    s.selectedId = object.id;
    s.selectedFaces = new Set([0]);
    s.subSelection = null;
    if (viewport) {
      viewport.objects = s.objects;
      viewport.updateObject?.(object);
      viewport.select?.(object.id, false);
    }
    setTool?.('move');
    markDirty?.(`Created ${object.name}`);
    try { renderTree?.(); renderProperties?.(); } catch {}
    toast?.('Decal placed on center-view surface.');
    report(`Placed ${object.name} at the first center-FOV surface.`, { position: object.position });
    return object;
  }

  function bindDecalButton(button) {
    if (!button || button.dataset.ephPovDecalV44 === '1') return;
    button.dataset.ephPovDecalV44 = '1';
    button.onclick = event => {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      createDecalAtViewCenter();
    };
    button.title = 'Place a decal on the first surface at the center of your view';
  }

  function bindDecalButtons() {
    bindDecalButton(document.getElementById('topAddDecal'));
    bindDecalButton(document.getElementById('ephRailDecal'));
  }

  function setUnpickable(node) {
    node.userData ||= {};
    node.userData.ephTransformGizmo = true;
    node.renderOrder = 10020;
    node.frustumCulled = false;
    node.raycast = () => {};
    return node;
  }

  function basicMaterial(T, color) {
    return new T.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: false, toneMapped: false });
  }

  function orientFromY(T, mesh, direction) {
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.clone().normalize());
  }

  function makeTranslateAxis(T, direction, color) {
    const group = new T.Group();
    const negative = direction.clone().multiplyScalar(-1).normalize();
    const shaftLength = 0.74;
    const headLength = 0.28;

    const shaft = setUnpickable(new T.Mesh(new T.CylinderGeometry(0.018, 0.018, shaftLength, 8), basicMaterial(T, color)));
    shaft.position.copy(negative).multiplyScalar(shaftLength * 0.5);
    orientFromY(T, shaft, negative);
    group.add(shaft);

    const head = setUnpickable(new T.Mesh(new T.ConeGeometry(0.105, headLength, 12), basicMaterial(T, color)));
    head.position.copy(negative).multiplyScalar(shaftLength + headLength * 0.5);
    orientFromY(T, head, negative);
    group.add(head);
    return group;
  }

  function makeScaleAxis(T, direction, color) {
    const group = new T.Group();
    const negative = direction.clone().multiplyScalar(-1).normalize();
    const shaftLength = 0.90;

    const shaft = setUnpickable(new T.Mesh(new T.CylinderGeometry(0.018, 0.018, shaftLength, 8), basicMaterial(T, color)));
    shaft.position.copy(negative).multiplyScalar(shaftLength * 0.5);
    orientFromY(T, shaft, negative);
    group.add(shaft);

    const handle = setUnpickable(new T.Mesh(new T.BoxGeometry(0.16, 0.16, 0.16), basicMaterial(T, color)));
    handle.position.copy(negative);
    group.add(handle);
    return group;
  }

  function removeLegacyNegativeRails(viewport) {
    const legacy = viewport?.scene?.getObjectByName?.('EPH_HammerNegativeAxisRails');
    if (!legacy) return;
    legacy.visible = false;
    legacy.parent?.remove?.(legacy);
  }

  function installCompleteGizmo(viewport) {
    const T = THREE();
    if (!viewport?.scene || !viewport?.transform || !T) return false;
    removeLegacyNegativeRails(viewport);

    const existing = viewport.scene.getObjectByName?.('EPH_CompleteNegativeTransformHandlesV44');
    if (existing) {
      mirrorGroup = existing;
      installedViewport = viewport;
      return true;
    }

    mirrorGroup?.parent?.remove?.(mirrorGroup);

    const root = new T.Group();
    root.name = 'EPH_CompleteNegativeTransformHandlesV44';
    root.userData.ephTransformGizmo = true;

    const translate = new T.Group();
    translate.name = 'translate';
    const scale = new T.Group();
    scale.name = 'scale';

    const axes = [
      [new T.Vector3(1, 0, 0), 0xff3653],
      [new T.Vector3(0, 1, 0), 0x65d63d],
      [new T.Vector3(0, 0, 1), 0x287dff],
    ];
    for (const [direction, color] of axes) {
      translate.add(makeTranslateAxis(T, direction, color));
      scale.add(makeScaleAxis(T, direction, color));
    }
    root.add(translate, scale);
    root.visible = false;
    viewport.scene.add(root);

    mirrorGroup = root;
    installedViewport = viewport;

    const update = () => {
      if (mirrorGroup !== root || installedViewport !== viewport) return;
      requestAnimationFrame(update);
      removeLegacyNegativeRails(viewport);

      const target = viewport.transform?.object;
      const mode = String(viewport.transform?.mode || '').toLowerCase();
      const shown = Boolean(target && (mode === 'translate' || mode === 'scale'));
      root.visible = shown;
      translate.visible = shown && mode === 'translate';
      scale.visible = shown && mode === 'scale';
      if (!shown) return;

      const position = target.getWorldPosition(new T.Vector3());
      root.position.copy(position);
      if (String(viewport.transform.space || 'world').toLowerCase() === 'local') root.quaternion.copy(target.getWorldQuaternion(new T.Quaternion()));
      else root.quaternion.identity();

      const rect = viewport.renderer?.domElement?.getBoundingClientRect?.();
      const height = Math.max(1, rect?.height || 720);
      const distance = Math.max(0.01, viewport.camera.position.distanceTo(position));
      const fov = (Number(viewport.camera.fov) || 65) * Math.PI / 180;
      const worldPerPixel = 2 * distance * Math.tan(fov * 0.5) / height;
      const length = Math.max(0.25, worldPerPixel * 47);
      root.scale.setScalar(length);
    };
    update();
    report('Complete negative move arrows and scale handles installed.');
    return true;
  }

  function canonicalSelectableId(id) {
    const s = state();
    if (!id || !s) return null;
    let resolved = window.EPH_SOLID_ENTITY_V30?.canonicalId?.(id) || id;
    let object = s.objects?.find(item => item?.id === resolved) || null;
    if (object?.ephMeshEntityChild && object.parent) {
      const parent = s.objects?.find(item => item?.id === object.parent);
      if (parent) { object = parent; resolved = parent.id; }
    }
    if (!object || ['world', 'folder'].includes(object.type) || object.visible === false) return null;
    return resolved;
  }

  function rootIdResolver(viewport) {
    const roots = new Map();
    for (const [id, root] of viewport.objectRoots || []) roots.set(root, id);
    return hitObject => {
      let node = hitObject;
      while (node) {
        if (roots.has(node)) return canonicalSelectableId(roots.get(node));
        if (node === viewport.objectGroup) break;
        node = node.parent;
      }
      return null;
    };
  }

  function selectableRoots(viewport) {
    const roots = [];
    for (const [id, root] of viewport.objectRoots || []) {
      if (!root?.visible || !canonicalSelectableId(id)) continue;
      roots.push(root);
    }
    return roots;
  }

  function raycastAtClient(viewport, rect, roots, resolveId, clientX, clientY) {
    const T = THREE();
    if (!T) return null;
    const pointer = new T.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    viewport.raycaster.setFromCamera(pointer, viewport.camera);
    const hits = viewport.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (hit.object?.userData?.ephTransformGizmo) continue;
      const id = resolveId(hit.object);
      if (id) return { id, distance: Number(hit.distance) || Infinity };
    }
    return null;
  }

  function improvedSelectAt(event) {
    const viewport = window.EPH3D || state()?.viewport;
    const canvas = viewport?.renderer?.domElement;
    if (!viewport || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const roots = selectableRoots(viewport);
    if (!roots.length) return null;
    const resolveId = rootIdResolver(viewport);
    const oldLine = viewport.raycaster.params?.Line?.threshold;
    const oldPoints = viewport.raycaster.params?.Points?.threshold;
    if (viewport.raycaster.params?.Line) viewport.raycaster.params.Line.threshold = Math.max(2, Number(oldLine) || 0);
    if (viewport.raycaster.params?.Points) viewport.raycaster.params.Points.threshold = Math.max(3, Number(oldPoints) || 0);

    try {
      // Exact visible geometry always wins. If the object is extremely thin or
      // the click lands a few pixels off its triangle/line, sample a tiny disc
      // around the pointer. This targets the rendered object itself, not its
      // origin/center, so any visible little edge or corner can be selected.
      const offsets = [[0, 0]];
      for (const radius of [3, 5, PICK_RADIUS_PX]) {
        offsets.push([radius, 0], [-radius, 0], [0, radius], [0, -radius]);
        const diagonal = radius * 0.70710678;
        offsets.push([diagonal, diagonal], [-diagonal, diagonal], [diagonal, -diagonal], [-diagonal, -diagonal]);
      }
      for (const [dx, dy] of offsets) {
        const hit = raycastAtClient(viewport, rect, roots, resolveId, event.clientX + dx, event.clientY + dy);
        if (hit?.id) return hit.id;
      }
      return null;
    } finally {
      if (viewport.raycaster.params?.Line && oldLine !== undefined) viewport.raycaster.params.Line.threshold = oldLine;
      if (viewport.raycaster.params?.Points && oldPoints !== undefined) viewport.raycaster.params.Points.threshold = oldPoints;
    }
  }

  function patchSelectionPicker() {
    const picker = window.EPH_SURFACE_MOVE_V39;
    if (!picker || picker.selectAt?.__ephWidePickV44) return Boolean(picker);
    const replacement = event => improvedSelectAt(event);
    replacement.__ephWidePickV44 = true;
    replacement.__ephPrevious = picker.selectAt;
    picker.selectAt = replacement;
    report('Selection now uses visible geometry with an 8px thin-object tolerance instead of object-center proximity.');
    return true;
  }

  function install(viewport = window.EPH3D || state()?.viewport) {
    ensureStyle();
    removeTopCsgUndo();
    bindDecalButtons();
    patchSelectionPicker();
    if (viewport) installCompleteGizmo(viewport);
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  const observer = new MutationObserver(() => {
    removeTopCsgUndo();
    bindDecalButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    removeTopCsgUndo();
    bindDecalButtons();
    patchSelectionPicker();
    const viewport = window.EPH3D || state()?.viewport;
    if (viewport && (installedViewport !== viewport || !viewport.scene?.getObjectByName?.('EPH_CompleteNegativeTransformHandlesV44'))) installCompleteGizmo(viewport);
    if (checks >= 80) clearInterval(guard);
  }, 250);

  window.EPH_INTERACTION_POLISH_V44 = {
    placeDecalAtCenter: createDecalAtViewCenter,
    selectAt: improvedSelectAt,
    reinstall: install,
  };

  report('POV decals, complete transform handles, topbar cleanup and wide visible-geometry selection enabled.');
})();
