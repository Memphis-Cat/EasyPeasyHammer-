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
  const FILL_OPACITY = 0.055;

  let installedViewport = null;
  let highlightRoot = null;
  let boundsHelper = null;
  let boundsBox = null;
  let dimensionRoot = null;
  let dimensionLabels = [];
  let currentDisplayRoot = null;
  let currentSelectedId = null;
  let transformListenersInstalled = null;

  const objects = () => state()?.objects || [];
  const objectById = id => objects().find(object => object?.id === id) || null;

  function logicalSelectionId(viewport) {
    const s = state();
    if (s && Object.prototype.hasOwnProperty.call(s, 'selectedId')) return s.selectedId ?? null;
    return viewport?.selectedId ?? null;
  }

  function displayRootFor(viewport, id = logicalSelectionId(viewport)) {
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

  function disposeMaterial(material) {
    if (!material) return;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else material.dispose?.();
  }

  function disposeOverlay(node) {
    if (!node) return;
    node.traverse?.(child => {
      if (child.userData?.ephSelectionOwnedGeometry) child.geometry?.dispose?.();
      if (child.userData?.ephSelectionOwnedMaterial) disposeMaterial(child.material);
      if (child.userData?.ephSelectionOwnedTexture) child.material?.map?.dispose?.();
    });
    node.parent?.remove?.(node);
  }

  function clearDimensions() {
    disposeOverlay(dimensionRoot);
    dimensionRoot = null;
    dimensionLabels = [];
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
    clearDimensions();
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
      // This MUST depth-test against the real selected model. With depthTest
      // disabled, the enlarged back-face copy paints the entire model solid
      // yellow instead of only showing around its silhouette.
      depthTest: true,
      depthWrite: false,
      side: T.BackSide,
      toneMapped: false,
    });
  }

  function lineMaterial(T) {
    return new T.LineBasicMaterial({ color: SELECTION_YELLOW, transparent: true, opacity: 0.98, depthTest: false, depthWrite: false, toneMapped: false });
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

    const specs = [
      ['x', '#ff5b5b'],
      ['y', '#76e05d'],
      ['z', '#5c8dff'],
    ];
    for (const [axis, color] of specs) {
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

  function updateBounds() {
    const T = THREE();
    const viewport = installedViewport;
    if (!T || !currentDisplayRoot || !boundsBox || !boundsHelper) return;
    const overlayVisible = highlightRoot?.visible;
    const dimsVisible = dimensionRoot?.visible;
    if (highlightRoot) highlightRoot.visible = false;
    if (dimensionRoot) dimensionRoot.visible = false;
    try { boundsBox.setFromObject(currentDisplayRoot, true); }
    finally {
      if (highlightRoot) highlightRoot.visible = overlayVisible !== false;
      if (dimensionRoot) dimensionRoot.visible = dimsVisible !== false;
    }
    boundsHelper.visible = !boundsBox.isEmpty();
    updateDimensions(viewport);
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
      else if (!logicalSelectionId(viewport)) clearHighlight();
    }
    if (checks >= 80) clearInterval(guard);
  }, 250);

  window.EPH_HAMMER_SELECTION_V46 = { install, rebuild, clear: clearHighlight };
  console.info('[Hammer Selection V46] Yellow silhouette with true low-opacity yellow tint, dimensions and deselection parity installed.');
})();
