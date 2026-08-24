// byanca
(() => {
  'use strict';
  if (window.__ephHammerSelectionV46) return;
  window.__ephHammerSelectionV46 = true;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;
  const cloneSkeleton = source => {
    const clone = window.EPH_THREE_HELPERS?.cloneSkeleton;
    try { return clone ? clone(source) : source.clone(true); }
    catch { try { return source.clone(true); } catch { return null; } }
  };
  const YELLOW = 0xffd84d;
  const FILL_OPACITY = 0.22;
  const HIGHLIGHT_NAME = 'EPH_HammerSelectionHighlightV46';
  const BOX_NAME = 'EPH_HammerSelectionBoundsV46';
  const DIMENSION_NAME = 'EPH_HammerSelectionDimensionsV46';

  let installedViewport = null;
  let highlightEntries = [];
  let boundsBox = null;
  let boundsHelper = null;
  let dimensionRoot = null;
  let dimensionLabels = [];
  let displayRoots = [];
  let selectionKey = '';
  let transformListenersInstalled = null;
  let rebuildFrame = 0;
  let pendingForce = false;
  const labelCache = new Map();

  const objects = () => state()?.objects || [];
  const objectById = id => objects().find(object => object?.id === id) || null;
  const selectable = object => Boolean(object && !['world', 'folder'].includes(object.type) && object.visible !== false);

  function logicalSelectionIds(viewport) {
    const s = state();
    const result = [];
    const add = id => {
      if (!id || result.includes(id)) return;
      const object = objectById(id);
      if (selectable(object)) result.push(id);
    };
    try { for (const id of window.EPH_MULTI_SELECTION?.ids?.() || []) add(id); } catch {}
    for (const id of Array.isArray(s?.multiSelectedIds) ? s.multiSelectedIds : []) add(id);
    for (const id of Array.isArray(viewport?.multiSelectedIds) ? viewport.multiSelectedIds : []) add(id);
    add(s?.selectedId ?? viewport?.selectedId ?? null);
    return result;
  }

  function displayRootsFor(viewport, id) {
    const object = objectById(id);
    if (!object || !viewport?.objectRoots) return [];
    if (['entity', 'prop'].includes(object.type) && (object.ephMeshEntity || object.ephMeshChildIds?.length)) {
      const ids = new Set(object.ephMeshChildIds || []);
      for (const child of objects()) if (child?.type === 'part' && child.parent === object.id) ids.add(child.id);
      const roots = [...ids].map(childId => viewport.objectRoots.get(childId)).filter(root => root?.visible);
      if (roots.length) return roots;
    }
    if (object.ephMeshEntityChild && object.parent) return displayRootsFor(viewport, object.parent);
    const root = viewport.objectRoots.get(id);
    return root?.visible ? [root] : [];
  }

  function selectedEntries(viewport) {
    const seen = new Set();
    const result = [];
    for (const id of logicalSelectionIds(viewport)) {
      for (const root of displayRootsFor(viewport, id)) {
        const key = root.uuid || root.id || `${id}:${result.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ id, root, key });
      }
    }
    return result;
  }

  function markOverlay(root) {
    root.traverse?.(node => {
      node.userData ||= {};
      node.userData.ephSelectionHighlight = true;
      node.userData.ephVisual = false;
      node.frustumCulled = false;
      node.raycast = () => {};
      if (node.isLight || node.isCamera) node.visible = false;
    });
    return root;
  }

  function removeNestedHelpers(root) {
    const remove = [];
    root.traverse?.(node => {
      if (node === root) return;
      if (node.userData?.ephSelectionHighlight || node.userData?.ephTransformGizmo) remove.push(node);
      if ([HIGHLIGHT_NAME, BOX_NAME, DIMENSION_NAME].includes(node.name)) remove.push(node);
    });
    for (const node of remove) node.parent?.remove?.(node);
  }

  function makeSharedMaterial(T, mode) {
    if (mode === 'fill') return new T.MeshBasicMaterial({
      color: YELLOW,
      transparent: true,
      opacity: FILL_OPACITY,
      depthTest: true,
      depthWrite: false,
      side: T.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    return new T.MeshBasicMaterial({
      color: YELLOW,
      transparent: true,
      opacity: 0.96,
      depthTest: true,
      depthWrite: false,
      side: T.BackSide,
      toneMapped: false,
    });
  }

  function makeSharedLineMaterial(T) {
    return new T.LineBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false, toneMapped: false });
  }

  function styleClone(root, mode, meshMaterial, lineMaterial) {
    let count = 0;
    root.traverse?.(node => {
      node.userData ||= {};
      node.userData.ephSelectionHighlight = true;
      node.userData.ephVisual = false;
      node.raycast = () => {};
      node.frustumCulled = false;
      if (node.isMesh || node.isSkinnedMesh) {
        node.material = meshMaterial;
        node.castShadow = false;
        node.receiveShadow = false;
        node.renderOrder = mode === 'outline' ? 10031 : 10030;
        count++;
      } else if (node.isLine || node.isLineSegments || node.isPoints) {
        node.material = lineMaterial;
        node.renderOrder = 10032;
        count++;
      } else if (node.isSprite) {
        const T = THREE();
        node.material = new T.SpriteMaterial({ map: node.material?.map || null, color: YELLOW, transparent: true, opacity: mode === 'outline' ? 0.72 : 0.32, depthTest: true, depthWrite: false, toneMapped: false });
        node.userData.ephSelectionOwnedMaterial = true;
        node.renderOrder = 10032;
        count++;
      } else if (node.isLight || node.isCamera) node.visible = false;
    });
    return count;
  }

  function disposeOverlay(root) {
    if (!root) return;
    root.traverse?.(node => {
      if (node.userData?.ephSelectionOwnedMaterial) node.material?.dispose?.();
    });
    root.parent?.remove?.(root);
  }

  function makeHighlight(root, selectionId) {
    const T = THREE();
    if (!T || !root) return null;
    const overlay = markOverlay(new T.Group());
    overlay.name = HIGHLIGHT_NAME;
    overlay.userData.ephSelectionId = selectionId;
    const fillMaterial = makeSharedMaterial(T, 'fill');
    const outlineMaterial = makeSharedMaterial(T, 'outline');
    const lineMaterial = makeSharedLineMaterial(T);
    overlay.userData.ephOwnedMaterials = [fillMaterial, outlineMaterial, lineMaterial];

    const children = [...root.children].filter(child => child?.visible !== false && !child.userData?.ephSelectionHighlight && !child.userData?.ephTransformGizmo && ![HIGHLIGHT_NAME, BOX_NAME, DIMENSION_NAME].includes(child.name));
    let count = 0;
    for (const child of children) {
      const fill = cloneSkeleton(child);
      if (fill) {
        removeNestedHelpers(fill);
        const rendered = styleClone(fill, 'fill', fillMaterial, lineMaterial);
        if (rendered) { overlay.add(fill); count += rendered; }
      }
      const outline = cloneSkeleton(child);
      if (outline) {
        removeNestedHelpers(outline);
        const rendered = styleClone(outline, 'outline', outlineMaterial, lineMaterial);
        if (rendered) {
          outline.scale.multiplyScalar(1.006);
          overlay.add(outline);
          count += rendered;
        }
      }
    }
    if (!count) {
      fillMaterial.dispose(); outlineMaterial.dispose(); lineMaterial.dispose();
      return null;
    }
    return overlay;
  }

  function clearDimensions() {
    if (dimensionRoot) {
      dimensionRoot.traverse?.(node => { if (node.userData?.ephSelectionOwnedMaterial) node.material?.dispose?.(); });
      dimensionRoot.parent?.remove?.(dimensionRoot);
    }
    dimensionRoot = null;
    dimensionLabels = [];
  }

  function clearHighlight() {
    for (const entry of highlightEntries.splice(0)) {
      const materials = entry.highlight?.userData?.ephOwnedMaterials || [];
      disposeOverlay(entry.highlight);
      for (const material of materials) material?.dispose?.();
    }
    if (boundsHelper) {
      boundsHelper.parent?.remove?.(boundsHelper);
      boundsHelper.geometry?.dispose?.();
      boundsHelper.material?.dispose?.();
    }
    boundsHelper = null;
    boundsBox = null;
    clearDimensions();
    displayRoots = [];
    selectionKey = '';
  }

  function formatDimension(value) {
    const number = Math.abs(Number(value) || 0);
    const fixed = number >= 1000 ? number.toFixed(1) : number.toFixed(2);
    return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function labelTexture(text, color) {
    const T = THREE();
    const key = `${text}|${color}`;
    if (labelCache.has(key)) return labelCache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.82)';
    ctx.strokeText(text, 128, 32); ctx.fillStyle = color; ctx.fillText(text, 128, 32);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    labelCache.set(key, texture);
    if (labelCache.size > 96) {
      const first = labelCache.keys().next().value;
      const old = labelCache.get(first);
      labelCache.delete(first);
      old?.dispose?.();
    }
    return texture;
  }

  function ensureDimensions(viewport) {
    const T = THREE();
    if (!T || !viewport?.scene || dimensionRoot?.parent) return Boolean(dimensionRoot?.parent);
    dimensionRoot = markOverlay(new T.Group());
    dimensionRoot.name = DIMENSION_NAME;
    for (const [axis, color] of [['x', '#ff5b5b'], ['y', '#76e05d'], ['z', '#5c8dff']]) {
      const material = new T.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const sprite = markOverlay(new T.Sprite(material));
      sprite.userData.ephSelectionOwnedMaterial = true;
      sprite.userData.ephDimensionAxis = axis;
      sprite.userData.ephDimensionColor = color;
      sprite.renderOrder = 10050;
      dimensionRoot.add(sprite);
      dimensionLabels.push(sprite);
    }
    viewport.scene.add(dimensionRoot);
    return true;
  }

  function updateDimensions(viewport) {
    const T = THREE();
    if (!T || !boundsBox || boundsBox.isEmpty()) { if (dimensionRoot) dimensionRoot.visible = false; return; }
    ensureDimensions(viewport);
    if (!dimensionRoot) return;
    const size = boundsBox.getSize(new T.Vector3());
    const center = boundsBox.getCenter(new T.Vector3());
    const min = boundsBox.min, max = boundsBox.max;
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const pad = Math.max(4, Math.min(32, maxDim * 0.055));
    const spriteWidth = Math.max(18, Math.min(72, maxDim * 0.20));
    const spriteHeight = spriteWidth * 0.25;
    for (const sprite of dimensionLabels) {
      const axis = sprite.userData.ephDimensionAxis;
      const value = axis === 'x' ? size.x : axis === 'y' ? size.y : size.z;
      const texture = labelTexture(formatDimension(value), sprite.userData.ephDimensionColor);
      if (sprite.material.map !== texture) { sprite.material.map = texture; sprite.material.needsUpdate = true; }
      sprite.scale.set(spriteWidth, spriteHeight, 1);
      if (axis === 'x') sprite.position.set(center.x, min.y - pad, max.z + pad * .25);
      else if (axis === 'y') sprite.position.set(min.x - pad, center.y, max.z + pad * .25);
      else sprite.position.set(min.x - pad, min.y - pad, center.z);
    }
    dimensionRoot.visible = true;
  }

  function updateBounds(force = false) {
    const T = THREE();
    const viewport = installedViewport;
    if (!T || !viewport || !boundsBox || !boundsHelper || !displayRoots.length) return;
    if (viewport.transform?.dragging && !force) {
      boundsHelper.visible = false;
      if (dimensionRoot) dimensionRoot.visible = false;
      return;
    }
    const visibility = highlightEntries.map(entry => [entry.highlight, entry.highlight.visible]);
    for (const [highlight] of visibility) highlight.visible = false;
    try {
      boundsBox.makeEmpty();
      const temp = new T.Box3();
      for (const root of displayRoots) {
        temp.makeEmpty();
        temp.setFromObject(root, false);
        if (!temp.isEmpty()) boundsBox.union(temp);
      }
    } finally {
      for (const [highlight, visible] of visibility) highlight.visible = visible !== false;
    }
    boundsHelper.visible = !boundsBox.isEmpty();
    updateDimensions(viewport);
  }

  function entryKey(entries) { return entries.map(entry => `${entry.id}:${entry.key}`).sort().join('|'); }

  function rebuildNow(viewport = installedViewport, force = false) {
    rebuildFrame = 0;
    force = force || pendingForce;
    pendingForce = false;
    const T = THREE();
    if (!viewport?.scene || !T) return false;
    installedViewport = viewport;
    const entries = selectedEntries(viewport);
    const nextKey = entryKey(entries);
    if (!entries.length) { clearHighlight(); hideLegacySelectionHelper(viewport); return false; }
    const intact = highlightEntries.length === entries.length && highlightEntries.every(entry => entry.highlight?.parent && entries.some(next => next.id === entry.id && next.root === entry.root));
    if (!force && intact && nextKey === selectionKey) {
      displayRoots = entries.map(entry => entry.root);
      updateBounds(false);
      hideLegacySelectionHelper(viewport);
      return true;
    }

    clearHighlight();
    selectionKey = nextKey;
    displayRoots = entries.map(entry => entry.root);
    for (const entry of entries) {
      const highlight = makeHighlight(entry.root, entry.id);
      if (!highlight) continue;
      entry.root.add(highlight);
      highlightEntries.push({ id: entry.id, root: entry.root, highlight });
    }
    boundsBox = new T.Box3();
    boundsHelper = markOverlay(new T.Box3Helper(boundsBox, YELLOW));
    boundsHelper.name = BOX_NAME;
    boundsHelper.material.depthTest = false;
    boundsHelper.material.depthWrite = false;
    boundsHelper.material.transparent = true;
    boundsHelper.material.opacity = 0.98;
    boundsHelper.material.toneMapped = false;
    boundsHelper.renderOrder = 10040;
    viewport.scene.add(boundsHelper);
    ensureDimensions(viewport);
    updateBounds(true);
    hideLegacySelectionHelper(viewport);
    return true;
  }

  function scheduleRebuild(viewport = installedViewport, force = false) {
    installedViewport = viewport || installedViewport;
    pendingForce ||= Boolean(force);
    if (rebuildFrame) return;
    rebuildFrame = requestAnimationFrame(() => rebuildNow(installedViewport, pendingForce));
  }

  function copyMarkers(target, source) {
    for (const property of Object.keys(source || {})) if (property.startsWith('__eph')) target[property] = source[property];
  }

  function wrap(viewport, name, force = false) {
    const current = viewport?.[name];
    if (typeof current !== 'function' || current.__ephHammerSelectionV46) return false;
    const previous = current;
    const wrapped = function(...args) {
      const result = previous.apply(this, args);
      scheduleRebuild(this, force && !this.transform?.dragging);
      return result;
    };
    copyMarkers(wrapped, previous);
    wrapped.__ephHammerSelectionV46 = true;
    wrapped.__ephPrevious = previous;
    viewport[name] = wrapped;
    return true;
  }

  function installTransformListeners(viewport) {
    if (!viewport?.transform || transformListenersInstalled === viewport.transform) return;
    transformListenersInstalled = viewport.transform;
    viewport.transform.addEventListener?.('dragging-changed', event => {
      if (event.value) {
        if (boundsHelper) boundsHelper.visible = false;
        if (dimensionRoot) dimensionRoot.visible = false;
      } else scheduleRebuild(viewport, true);
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
    installTransformListeners(viewport);
    hideLegacySelectionHelper(viewport);
    scheduleRebuild(viewport, true);
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });
  window.addEventListener('eph-selection-changed', () => scheduleRebuild(installedViewport, true));

  window.EPH_HAMMER_SELECTION_V46 = {
    install,
    rebuild: (viewport = installedViewport, force = false) => { scheduleRebuild(viewport, force); return true; },
    clear: clearHighlight,
    ids: () => logicalSelectionIds(installedViewport),
  };
  console.info('[Hammer Selection V46] Shared-geometry yellow selection, cached dimensions and drag-safe bounds installed.');
})();
