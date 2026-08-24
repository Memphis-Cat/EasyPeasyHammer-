// byanca
(() => {
  'use strict';
  if (window.__ephHammerSelectionV46) return;
  window.__ephHammerSelectionV46 = true;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;
  const HIGHLIGHT_NAME = 'EPH_HammerSelectionHighlightV46';
  const BOX_NAME = 'EPH_HammerSelectionBoundsV46';
  const DIMENSION_NAME = 'EPH_HammerSelectionDimensionsV46';
  const SELECTION_YELLOW = 0xffd84d;
  const FILL_OPACITY = 0.13;

  let installedViewport = null;
  let highlightEntries = [];
  let boundsHelper = null;
  let boundsBox = null;
  let dimensionRoot = null;
  let dimensionLabels = [];
  let currentDisplayRoots = [];
  let currentSelectionKey = '';
  let transformListenersInstalled = null;

  const objects = () => state()?.objects || [];
  const objectById = id => objects().find(object => object?.id === id) || null;
  const selectableObject = object => Boolean(object && !['world', 'folder'].includes(object.type));

  function logicalSelectionIds(viewport) {
    const s = state();
    const result = [];
    const add = id => {
      if (!id || result.includes(id)) return;
      const object = objectById(id);
      if (selectableObject(object)) result.push(id);
    };

    if (Array.isArray(s?.multiSelectedIds)) for (const id of s.multiSelectedIds) add(id);
    add(s?.selectedId ?? viewport?.selectedId ?? null);
    return result;
  }

  function displayRootFor(viewport, id) {
    if (!viewport?.objectRoots || !id) return null;
    const object = objectById(id);

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

  function selectedDisplayEntries(viewport) {
    const seenRoots = new Set();
    const result = [];
    for (const id of logicalSelectionIds(viewport)) {
      const root = displayRootFor(viewport, id);
      if (!root?.visible) continue;
      const rootKey = root.uuid || root.id || id;
      if (seenRoots.has(rootKey)) continue;
      seenRoots.add(rootKey);
      result.push({ id, root, rootKey });
    }
    return result;
  }

  function disposeMaterial(material) {
    if (!material) return;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else material.dispose?.();
  }

  function disposeOverlay(node) {
    if (!node) return;
    node.traverse?.(child => {
      if (child.userData?.ephSelectionOwnedTexture) child.material?.map?.dispose?.();
      if (child.userData?.ephSelectionOwnedGeometry) child.geometry?.dispose?.();
      if (child.userData?.ephSelectionOwnedMaterial) disposeMaterial(child.material);
    });
    node.parent?.remove?.(node);
  }

  function clearDimensions() {
    disposeOverlay(dimensionRoot);
    dimensionRoot = null;
    dimensionLabels = [];
  }

  function clearHighlight() {
    for (const entry of highlightEntries.splice(0)) disposeOverlay(entry.highlight);
    if (boundsHelper) {
      boundsHelper.parent?.remove?.(boundsHelper);
      boundsHelper.geometry?.dispose?.();
      disposeMaterial(boundsHelper.material);
    }
    boundsHelper = null;
    boundsBox = null;
    clearDimensions();
    currentDisplayRoots = [];
    currentSelectionKey = '';
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
      if ([HIGHLIGHT_NAME, BOX_NAME, DIMENSION_NAME].includes(node.name)) remove.push(node);
    });
    for (const node of remove) node.parent?.remove?.(node);
  }

  function fillMaterial(T) {
    return new T.MeshBasicMaterial({
      color: SELECTION_YELLOW,
      transparent: true,
      opacity: FILL_OPACITY,
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
      color: SELECTION_YELLOW,
      transparent: true,
      opacity: 0.98,
      depthTest: true,
      depthWrite: false,
      side: T.BackSide,
      toneMapped: false,
    });
  }

  function lineMaterial(T) {
    return new T.LineBasicMaterial({
      color: SELECTION_YELLOW,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  function spriteMaterial(T, original = null) {
    return new T.SpriteMaterial({
      map: original?.map || null,
      color: SELECTION_YELLOW,
      transparent: true,
      opacity: 0.30,
      depthTest: true,
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

  function makeHighlight(displayRoot, selectionId) {
    const T = THREE();
    if (!T || !displayRoot) return null;
    const overlay = unpickable(new T.Group());
    overlay.name = HIGHLIGHT_NAME;
    overlay.userData.ephSelectionId = selectionId;

    const sourceChildren = [...displayRoot.children].filter(child =>
      child?.visible !== false
      && !child.userData?.ephSelectionHighlight
      && !child.userData?.ephTransformGizmo
      && ![HIGHLIGHT_NAME, BOX_NAME, DIMENSION_NAME].includes(child.name)
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
          outline.scale.multiplyScalar(1.006);
          overlay.add(outline);
          visible += count;
        } else disposeOverlay(outline);
      }
    }

    return visible ? overlay : null;
  }

  function formatDimension(value) {
    const number = Math.abs(Number(value) || 0);
    const fixed = number >= 1000 ? number.toFixed(1) : number.toFixed(2);
    return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function textSprite(text, color) {
    const T = THREE();
    if (!T || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,.82)';
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);

    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.needsUpdate = true;
    const material = new T.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const sprite = unpickable(new T.Sprite(material));
    sprite.userData.ephSelectionOwnedMaterial = true;
    sprite.userData.ephSelectionOwnedTexture = true;
    sprite.renderOrder = 10050;
    return sprite;
  }

  function ensureDimensions(viewport) {
    const T = THREE();
    if (!T || !viewport?.scene) return false;
    clearDimensions();
    dimensionRoot = unpickable(new T.Group());
    dimensionRoot.name = DIMENSION_NAME;
    for (const [axis, color] of [['x', '#ff5b5b'], ['y', '#76e05d'], ['z', '#5c8dff']]) {
      const sprite = textSprite('0', color);
      if (!sprite) continue;
      sprite.userData.ephDimensionAxis = axis;
      dimensionRoot.add(sprite);
      dimensionLabels.push(sprite);
    }
    viewport.scene.add(dimensionRoot);
    return true;
  }

  function updateDimensions(viewport) {
    const T = THREE();
    if (!T || !boundsBox || boundsBox.isEmpty()) {
      if (dimensionRoot) dimensionRoot.visible = false;
      return;
    }
    if (!dimensionRoot?.parent) ensureDimensions(viewport);
    if (!dimensionRoot) return;
    dimensionRoot.visible = true;

    const size = boundsBox.getSize(new T.Vector3());
    const center = boundsBox.getCenter(new T.Vector3());
    const min = boundsBox.min;
    const max = boundsBox.max;
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const pad = Math.max(4, Math.min(32, maxDim * 0.055));
    const spriteWidth = Math.max(18, Math.min(72, maxDim * 0.20));
    const spriteHeight = spriteWidth * 0.25;

    for (const sprite of dimensionLabels) {
      const axis = sprite.userData.ephDimensionAxis;
      const value = axis === 'x' ? size.x : axis === 'y' ? size.y : size.z;
      const oldMap = sprite.material?.map;
      const color = axis === 'x' ? '#ff5b5b' : axis === 'y' ? '#76e05d' : '#5c8dff';
      const replacement = textSprite(formatDimension(value), color);
      if (replacement?.material?.map) {
        sprite.material.map = replacement.material.map;
        sprite.material.needsUpdate = true;
        replacement.material.map = null;
        replacement.material.dispose?.();
        oldMap?.dispose?.();
      }
      sprite.scale.set(spriteWidth, spriteHeight, 1);
      if (axis === 'x') sprite.position.set(center.x, min.y - pad, max.z + pad * 0.25);
      else if (axis === 'y') sprite.position.set(min.x - pad, center.y, max.z + pad * 0.25);
      else sprite.position.set(min.x - pad, min.y - pad, center.z);
    }
  }

  function updateBounds(force = false) {
    const T = THREE();
    const viewport = installedViewport;
    if (!T || !viewport || !boundsBox || !boundsHelper || !currentDisplayRoots.length) return;

    // Selection overlays are children of the real roots, so they follow a drag
    // automatically. Avoid expensive Box3 walks on every gizmo mousemove and
    // refresh the aggregate dimensions once the drag ends.
    if (!force && viewport.transform?.dragging) return;

    const overlayVisibility = highlightEntries.map(entry => [entry.highlight, entry.highlight?.visible]);
    const dimsVisible = dimensionRoot?.visible;
    for (const [highlight] of overlayVisibility) if (highlight) highlight.visible = false;
    if (dimensionRoot) dimensionRoot.visible = false;

    try {
      boundsBox.makeEmpty();
      const temporary = new T.Box3();
      for (const root of currentDisplayRoots) {
        temporary.makeEmpty();
        temporary.setFromObject(root, true);
        if (!temporary.isEmpty()) boundsBox.union(temporary);
      }
    } finally {
      for (const [highlight, visible] of overlayVisibility) if (highlight) highlight.visible = visible !== false;
      if (dimensionRoot) dimensionRoot.visible = dimsVisible !== false;
    }

    boundsHelper.visible = !boundsBox.isEmpty();
    updateDimensions(viewport);
  }

  function selectionKey(entries) {
    return entries.map(entry => `${entry.id}:${entry.rootKey}`).sort().join('|');
  }

  function rebuild(viewport = installedViewport, force = false) {
    const T = THREE();
    if (!viewport?.scene || !T) return false;
    installedViewport = viewport;
    const entries = selectedDisplayEntries(viewport);
    const nextKey = selectionKey(entries);

    if (!entries.length) {
      clearHighlight();
      hideLegacySelectionHelper(viewport);
      return false;
    }

    const intact = highlightEntries.length === entries.length
      && highlightEntries.every(entry => entry.highlight?.parent && entries.some(next => next.id === entry.id && next.root === entry.root));
    if (!force && intact && nextKey === currentSelectionKey) {
      currentDisplayRoots = entries.map(entry => entry.root);
      updateBounds(false);
      hideLegacySelectionHelper(viewport);
      return true;
    }

    clearHighlight();
    currentSelectionKey = nextKey;
    currentDisplayRoots = entries.map(entry => entry.root);

    for (const entry of entries) {
      const highlight = makeHighlight(entry.root, entry.id);
      if (!highlight) continue;
      entry.root.add(highlight);
      highlightEntries.push({ id: entry.id, root: entry.root, highlight });
    }

    boundsBox = new T.Box3();
    boundsHelper = unpickable(new T.Box3Helper(boundsBox, SELECTION_YELLOW));
    boundsHelper.name = BOX_NAME;
    boundsHelper.material.depthTest = false;
    boundsHelper.material.depthWrite = false;
    boundsHelper.material.transparent = true;
    boundsHelper.material.opacity = 1;
    boundsHelper.material.toneMapped = false;
    boundsHelper.renderOrder = 10040;
    viewport.scene.add(boundsHelper);
    ensureDimensions(viewport);
    updateBounds(true);
    hideLegacySelectionHelper(viewport);
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
    viewport.transform.addEventListener?.('objectChange', () => updateBounds(false));
    viewport.transform.addEventListener?.('change', () => updateBounds(false));
    viewport.transform.addEventListener?.('dragging-changed', event => {
      if (!event.value) updateBounds(true);
    });
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
  window.addEventListener('eph-selection-changed', () => queueMicrotask(() => rebuild(installedViewport, true)));

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const viewport = window.EPH3D || state()?.viewport;
    if (viewport) {
      install(viewport);
      rebuild(viewport, false);
    }
    if (checks >= 80) clearInterval(guard);
  }, 250);

  window.EPH_HAMMER_SELECTION_V46 = {
    install,
    rebuild,
    clear: clearHighlight,
    ids: () => logicalSelectionIds(installedViewport),
  };
  console.info('[Hammer Selection V46] Unified yellow selection overlays, aggregate dimensions and deselection parity installed.');
})();
