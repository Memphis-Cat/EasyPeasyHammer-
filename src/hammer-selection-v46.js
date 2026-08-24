// byanca
(() => {
  'use strict';
  if (window.__ephHammerSelectionV46) return;
  window.__ephHammerSelectionV46 = true;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;
  const HIGHLIGHT_NAME = 'EPH_HammerSelectionHighlightV46';
  const BOX_NAME = 'EPH_HammerSelectionBoundsV46';
  const FILL_COLOR = 0xf0a532;
  const OUTLINE_COLOR = 0xffd84d;

  let installedViewport = null;
  let highlightRoot = null;
  let boundsHelper = null;
  let boundsBox = null;
  let currentDisplayRoot = null;
  let currentSelectedId = null;
  let transformListenersInstalled = null;

  const objects = () => state()?.objects || [];
  const objectById = id => objects().find(object => object?.id === id) || null;

  function logicalSelectionId(viewport) {
    return state()?.selectedId || viewport?.selectedId || null;
  }

  function displayRootFor(viewport, id = logicalSelectionId(viewport)) {
    if (!viewport?.objectRoots || !id) return null;
    const object = objectById(id);

    // Brush/mesh entities are logically selected as the entity wrapper but the
    // visible/editable solid is their owned Part. Highlight the same geometry
    // that Move/Rotate/Scale uses, while Properties stay on the entity.
    if (object && ['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length)) {
      const ids = new Set(object.ephMeshChildIds || []);
      for (const child of objects()) if (child?.type === 'part' && child.parent === object.id) ids.add(child.id);
      for (const childId of ids) {
        const root = viewport.objectRoots.get(childId);
        if (root?.visible) return root;
      }
    }

    if (object?.ephMeshEntityChild && object.parent) {
      const parent = objectById(object.parent);
      if (parent) return displayRootFor(viewport, parent.id);
    }

    return viewport.objectRoots.get(id) || null;
  }

  function disposeMaterial(material) {
    if (!material) return;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else material.dispose?.();
  }

  function disposeOverlay(node) {
    if (!node) return;
    node.traverse?.(child => {
      // Highlight clones get their own geometry before styling. Never dispose a
      // geometry/material that could still be shared with the real map object.
      if (child.userData?.ephSelectionOwnedGeometry) child.geometry?.dispose?.();
      if (child.userData?.ephSelectionOwnedMaterial) disposeMaterial(child.material);
    });
    node.parent?.remove?.(node);
  }

  function clearHighlight() {
    disposeOverlay(highlightRoot);
    highlightRoot = null;
    if (boundsHelper) {
      boundsHelper.parent?.remove?.(boundsHelper);
      boundsHelper.geometry?.dispose?.();
      disposeMaterial(boundsHelper.material);
    }
    boundsHelper = null;
    boundsBox = null;
    currentDisplayRoot = null;
    currentSelectedId = null;
  }

  function unpickable(node) {
    node.userData ||= {};
    node.userData.ephSelectionHighlight = true;
    node.userData.ephVisual = false;
    node.raycast = () => {};
    node.frustumCulled = false;
    return node;
  }

  function cloneRenderable(source) {
    const cloneSkeleton = window.EPH_THREE_HELPERS?.cloneSkeleton;
    try {
      if (cloneSkeleton) return cloneSkeleton(source);
      return source.clone(true);
    } catch {
      try { return source.clone(true); } catch { return null; }
    }
  }

  function removeNonVisualChildren(root) {
    const remove = [];
    root.traverse?.(node => {
      if (node === root) return;
      if (node.userData?.ephSelectionHighlight || node.userData?.ephTransformGizmo) remove.push(node);
      if (node.name === HIGHLIGHT_NAME || node.name === BOX_NAME) remove.push(node);
    });
    for (const node of remove) node.parent?.remove?.(node);
  }

  function fillMaterial(T) {
    return new T.MeshBasicMaterial({
      color: FILL_COLOR,
      transparent: true,
      opacity: 0.28,
      depthTest: true,
      depthWrite: false,
      side: T.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  function outlineMaterial(T) {
    return new T.MeshBasicMaterial({
      color: OUTLINE_COLOR,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
      side: T.BackSide,
      toneMapped: false,
    });
  }

  function lineMaterial(T) {
    return new T.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0.98, depthTest: false, depthWrite: false, toneMapped: false });
  }

  function spriteMaterial(T, original = null) {
    return new T.SpriteMaterial({
      map: original?.map || null,
      color: OUTLINE_COLOR,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  function ownGeometry(node) {
    if (!node?.geometry?.clone) return;
    node.geometry = node.geometry.clone();
    node.userData ||= {};
    node.userData.ephSelectionOwnedGeometry = true;
  }

  function ownMaterial(node, material) {
    node.material = material;
    node.userData ||= {};
    node.userData.ephSelectionOwnedMaterial = true;
  }

  function styleClone(root, mode) {
    const T = THREE();
    if (!T || !root) return 0;
    let renderables = 0;
    root.traverse?.(node => {
      unpickable(node);
      if (node.isMesh || node.isSkinnedMesh) {
        ownGeometry(node);
        ownMaterial(node, mode === 'outline' ? outlineMaterial(T) : fillMaterial(T));
        node.castShadow = false;
        node.receiveShadow = false;
        node.renderOrder = mode === 'outline' ? 10031 : 10030;
        renderables++;
      } else if (node.isLine || node.isLineSegments || node.isPoints) {
        ownGeometry(node);
        ownMaterial(node, lineMaterial(T));
        node.renderOrder = 10032;
        renderables++;
      } else if (node.isSprite) {
        const old = node.material;
        ownMaterial(node, spriteMaterial(T, old));
        node.renderOrder = 10032;
        renderables++;
      } else if (node.isLight || node.isCamera) {
        node.visible = false;
      }
    });
    return renderables;
  }

  function makeHighlight(displayRoot) {
    const T = THREE();
    if (!T || !displayRoot) return null;
    const overlay = new T.Group();
    overlay.name = HIGHLIGHT_NAME;
    unpickable(overlay);

    const sourceChildren = [...displayRoot.children].filter(child =>
      child?.visible !== false
      && !child.userData?.ephSelectionHighlight
      && !child.userData?.ephTransformGizmo
      && child.name !== HIGHLIGHT_NAME
      && child.name !== BOX_NAME
    );

    let visible = 0;
    for (const child of sourceChildren) {
      const fill = cloneRenderable(child);
      if (fill) {
        removeNonVisualChildren(fill);
        const count = styleClone(fill, 'fill');
        if (count) { overlay.add(fill); visible += count; }
        else disposeOverlay(fill);
      }

      const outline = cloneRenderable(child);
      if (outline) {
        removeNonVisualChildren(outline);
        const count = styleClone(outline, 'outline');
        if (count) {
          // Hammer's selected-model silhouette is a thin yellow expansion around
          // the actual model, not a generic center marker. Scale the visual copy
          // only; the selected object's real transform/geometry is untouched.
          outline.scale.multiplyScalar(1.0125);
          overlay.add(outline);
          visible += count;
        } else disposeOverlay(outline);
      }
    }

    return visible ? overlay : null;
  }

  function updateBounds() {
    const T = THREE();
    if (!T || !currentDisplayRoot || !boundsBox || !boundsHelper) return;
    const overlayVisible = highlightRoot?.visible;
    if (highlightRoot) highlightRoot.visible = false;
    try { boundsBox.setFromObject(currentDisplayRoot, true); }
    finally { if (highlightRoot) highlightRoot.visible = overlayVisible !== false; }
    boundsHelper.visible = !boundsBox.isEmpty();
  }

  function rebuild(viewport = installedViewport, force = false) {
    const T = THREE();
    if (!viewport?.scene || !T) return false;
    const selectedId = logicalSelectionId(viewport);
    const displayRoot = displayRootFor(viewport, selectedId);

    if (!selectedId || !displayRoot || !displayRoot.visible) {
      clearHighlight();
      return false;
    }

    if (!force && currentSelectedId === selectedId && currentDisplayRoot === displayRoot && highlightRoot?.parent) {
      updateBounds();
      return true;
    }

    clearHighlight();
    currentSelectedId = selectedId;
    currentDisplayRoot = displayRoot;

    highlightRoot = makeHighlight(displayRoot);
    if (highlightRoot) displayRoot.add(highlightRoot);

    boundsBox = new T.Box3();
    boundsHelper = unpickable(new T.Box3Helper(boundsBox, OUTLINE_COLOR));
    boundsHelper.name = BOX_NAME;
    boundsHelper.material.depthTest = false;
    boundsHelper.material.depthWrite = false;
    boundsHelper.material.transparent = true;
    boundsHelper.material.opacity = 1;
    boundsHelper.material.toneMapped = false;
    boundsHelper.renderOrder = 10040;
    viewport.scene.add(boundsHelper);
    updateBounds();
    return true;
  }

  function wrap(viewport, name, forceRebuild = false) {
    const current = viewport?.[name];
    if (typeof current !== 'function' || current.__ephHammerSelectionV46) return false;
    const previous = current;
    const wrapped = function(...args) {
      const result = previous.apply(this, args);
      const force = forceRebuild && !this.transform?.dragging;
      queueMicrotask(() => rebuild(this, force));
      return result;
    };
    for (const property of Object.keys(previous)) if (property.startsWith('__eph')) wrapped[property] = previous[property];
    wrapped.__ephHammerSelectionV46 = true;
    wrapped.__ephPrevious = previous;
    viewport[name] = wrapped;
    return true;
  }

  function installTransformListeners(viewport) {
    if (!viewport?.transform || transformListenersInstalled === viewport.transform) return;
    transformListenersInstalled = viewport.transform;
    viewport.transform.addEventListener?.('objectChange', updateBounds);
    viewport.transform.addEventListener?.('change', updateBounds);
    viewport.transform.addEventListener?.('dragging-changed', updateBounds);
  }

  function hideLegacySelectionHelper(viewport) {
    for (const name of ['selectionBox', 'selectionHelper', 'boxHelper']) {
      const helper = viewport?.[name];
      if (!helper || helper === boundsHelper || helper.userData?.ephSelectionHighlight) continue;
      if (helper.isBox3Helper || /selection|boxhelper/i.test(String(helper.name || ''))) helper.visible = false;
    }
  }

  function install(viewport = window.EPH3D || state()?.viewport) {
    if (!viewport?.objectRoots || !viewport?.scene || !THREE()) return false;
    installedViewport = viewport;
    wrap(viewport, 'select', true);
    wrap(viewport, 'setObjects', true);
    // Async prop/entity model loads normally call updateObject/updateSelectionBox.
    // Rebuild the amber overlay then, but never recreate heavy model clones in
    // the middle of an active transform drag.
    wrap(viewport, 'updateObject', true);
    wrap(viewport, 'updateSelectionBox', false);
    wrap(viewport, 'setTool', false);
    installTransformListeners(viewport);
    hideLegacySelectionHelper(viewport);
    queueMicrotask(() => rebuild(viewport, true));
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const viewport = window.EPH3D || state()?.viewport;
    if (viewport) {
      install(viewport);
      hideLegacySelectionHelper(viewport);
      if (highlightRoot?.parent) updateBounds();
    }
    if (checks >= 80) clearInterval(guard);
  }, 250);

  window.EPH_HAMMER_SELECTION_V46 = { install, rebuild, clear: clearHighlight };
  console.info('[Hammer Selection V46] Hammer-style amber selection fill, yellow silhouette and yellow bounds installed for every selectable object type.');
})();
