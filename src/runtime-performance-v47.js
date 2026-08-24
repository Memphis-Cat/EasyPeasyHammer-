// byanca
(() => {
  'use strict';
  if (window.__ephRuntimePerformanceV47) return;
  window.__ephRuntimePerformanceV47 = true;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;
  const YELLOW = 0xffd84d;
  const SELECTION_FILL_OPACITY = 0.13;

  let assetBrowserActivated = false;
  let assetStatusOriginal = null;
  let assetStatusPending = null;
  let assetStatusScheduled = false;

  function runAssetStatusRefresh(immediate = false) {
    if (!assetStatusOriginal) return Promise.resolve(state()?.assetStatus || null);
    if (assetStatusPending) return assetStatusPending;

    const execute = () => {
      assetStatusScheduled = false;
      if (assetStatusPending) return assetStatusPending;
      assetStatusPending = Promise.resolve(assetStatusOriginal())
        .catch(error => {
          console.warn('[Runtime Performance V47] Background CS2 asset status failed.', error);
          return state()?.assetStatus || null;
        })
        .finally(() => { assetStatusPending = null; });
      return assetStatusPending;
    };

    if (immediate) return execute();
    if (assetStatusScheduled) return Promise.resolve(state()?.assetStatus || null);
    assetStatusScheduled = true;

    // Map parsing, scene creation and the first visible WebGL frame get priority.
    // The AssetHost can touch tens of thousands of Source 2 resources on a cold
    // launch, so do not make it compete with the first map frame.
    setTimeout(() => {
      const start = () => execute();
      if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 1600 });
      else setTimeout(start, 0);
    }, 1200);
    return Promise.resolve(state()?.assetStatus || null);
  }

  try {
    if (typeof refreshAssetStatus === 'function' && !refreshAssetStatus.__ephNonBlockingV47) {
      assetStatusOriginal = refreshAssetStatus;
      const wrapped = function() {
        const s = state();
        if (assetBrowserActivated) return runAssetStatusRefresh(true);
        if (s?.project) runAssetStatusRefresh(false);
        // The startup/home screen never needs to index CS2 assets. Returning
        // immediately is intentional; a loaded map or Asset Browser interaction
        // starts the background refresh later.
        return Promise.resolve(s?.assetStatus || null);
      };
      wrapped.__ephNonBlockingV47 = true;
      wrapped.__ephPrevious = assetStatusOriginal;
      refreshAssetStatus = wrapped;
      window.refreshAssetStatus = wrapped;
    }
  } catch {}

  try {
    const proto = globalThis.Element?.prototype;
    const previous = proto?.requestPointerLock;
    if (typeof previous === 'function' && !previous.__ephSafePointerLockV47) {
      const wrapped = function(...args) {
        if (!this?.isConnected || this.ownerDocument !== document || document.visibilityState === 'hidden') return Promise.resolve();
        if (document.pointerLockElement === this) return Promise.resolve();
        try {
          const result = previous.apply(this, args);
          result?.catch?.(() => {});
          return result;
        } catch {
          return Promise.resolve();
        }
      };
      wrapped.__ephSafePointerLockV47 = true;
      wrapped.__ephPrevious = previous;
      proto.requestPointerLock = wrapped;
    }
  } catch {}

  function installAngleUiFix() {
    const angle = document.getElementById('angleSnap');
    if (angle) {
      for (const option of angle.options || []) {
        const number = Number(String(option.value || option.textContent || '').replace(/[^0-9.+-]/g, ''));
        if (Number.isFinite(number)) option.value = String(number);
      }
      if (state()) angle.value = String(Number(state().angleSnap) || 15);
    }

    try {
      if (typeof renderViewportControls === 'function' && !renderViewportControls.__ephNumericAngleV47) {
        const previous = renderViewportControls;
        const wrapped = function() {
          const s = state();
          const get = id => document.getElementById(id);
          if (!s) return previous?.();
          get('viewport')?.classList.toggle('grid-enabled', s.grid);
          const perspective = get('perspectiveButton');
          const shading = get('shadingButton');
          if (perspective?.childNodes?.[0]) perspective.childNodes[0].nodeValue = `${s.view} `;
          if (shading?.childNodes?.[0]) shading.childNodes[0].nodeValue = `${s.shading} `;
          const snap = get('snapButton');
          snap?.classList.toggle('active', s.snap);
          if (snap) snap.textContent = `Snap: ${s.snap ? 'On' : 'Off'}`;
          const grid = get('gridSize');
          if (grid) grid.value = String(s.gridSize);
          const angleInput = get('angleSnap');
          if (angleInput) angleInput.value = String(Number(s.angleSnap) || 15);
          try { viewportSettings?.(); } catch {}
        };
        wrapped.__ephNumericAngleV47 = true;
        wrapped.__ephPrevious = previous;
        renderViewportControls = wrapped;
        window.renderViewportControls = wrapped;
      }
    } catch {}
  }

  function sanitizeFgdInputTypes() {
    let changed = 0;
    const entities = typeof ENTITIES !== 'undefined' && Array.isArray(ENTITIES) ? ENTITIES : [];
    for (const entity of entities) {
      for (const property of entity?.properties || []) {
        const type = String(property?.type || '').toLowerCase();
        if (!/(?:qangle|vector|angle)/.test(type)) continue;
        if (!property.__ephOriginalTypeV47) property.__ephOriginalTypeV47 = property.type;
        property.type = 'string';
        changed++;
      }
    }
    return changed;
  }

  function installLazyAssetBrowser() {
    try {
      if (typeof assetSearchTimer !== 'undefined') clearTimeout(assetSearchTimer);
      if (typeof searchAssets !== 'function' || searchAssets.__ephLazyV47) return;
      const previous = searchAssets;
      const wrapped = async function(...args) {
        const s = state();
        const query = document.getElementById('assetSearch')?.value?.trim() || '';
        if (!assetBrowserActivated && !query && s?.assetTab === 'materials') {
          s.assetItems = Array.isArray(CORE_MATERIALS) ? [...CORE_MATERIALS] : [];
          s.assetTotal = Number(s.assetStatus?.materialCount || s.assetItems.length || 0);
          try { renderAssets?.(); } catch {}
          return;
        }
        if (!s?.assetStatus?.available && assetBrowserActivated) await runAssetStatusRefresh(true);
        return previous.apply(this, args);
      };
      wrapped.__ephLazyV47 = true;
      wrapped.__ephPrevious = previous;
      searchAssets = wrapped;
      window.searchAssets = wrapped;

      const activate = () => {
        const first = !assetBrowserActivated;
        assetBrowserActivated = true;
        if (first && !state()?.assetStatus?.available) {
          runAssetStatusRefresh(true).then(() => {
            try { renderAssetStatus?.(); } catch {}
            try { queueAssetSearch?.(true); } catch {}
          });
        }
      };
      document.getElementById('assetTabs')?.addEventListener('pointerdown', activate, true);
      document.getElementById('assetSearch')?.addEventListener('input', activate, true);
      document.getElementById('assetSearch')?.addEventListener('focus', activate, true);
    } catch {}
  }

  function isSolidEntity(object) {
    if (!object || !['entity', 'prop'].includes(object.type)) return false;
    if (object.ephMeshEntity || (object.ephMeshChildIds?.length || 0) > 0) return true;
    const className = String(object.className || '').toLowerCase();
    const entities = typeof ENTITIES !== 'undefined' && Array.isArray(ENTITIES) ? ENTITIES : [];
    const meta = entities.find(item => String(item?.className || '').toLowerCase() === className);
    return String(meta?.fgdKind || meta?.kind || '').toLowerCase() === 'solid';
  }

  function stabilizeEntityRenderer() {
    if (document.documentElement.dataset.ephRuntimeReady !== '1') return false;
    const viewport = window.EPH3D || state()?.viewport;
    const T = THREE();
    if (!viewport?.createEntityMarker || !T) return false;
    if (viewport.createEntityMarker.__ephStableEntityRendererV47) return true;

    const previous = viewport.createEntityMarker;
    const stable = function(object) {
      if (isSolidEntity(object)) {
        const group = new T.Group();
        group.userData.ephVisual = true;
        group.userData.ephMeshEntityWrapper = true;
        return group;
      }
      return previous.call(this, object);
    };
    for (const property of Object.keys(previous)) if (property.startsWith('__eph')) stable[property] = previous[property];
    stable.__ephStableEntityRendererV47 = true;
    stable.__ephSolidEntityV24 = true;
    stable.__ephEntityModelBasisV41 = true;
    stable.__ephHammerFgdVisualsV42 = true;
    stable.__ephHammerParityV45 = true;
    stable.__ephHammerFinalV18 = true;
    stable.__ephPrevious = previous;
    viewport.createEntityMarker = stable;
    return true;
  }

  function tuneSelectionOpacity(viewport = window.EPH3D || state()?.viewport) {
    const scene = viewport?.scene;
    if (!scene) return;
    const root = scene.getObjectByName?.('EPH_HammerSelectionHighlightV46');
    if (!root) return;
    root.traverse?.(node => {
      if (node.renderOrder !== 10030 || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = SELECTION_FILL_OPACITY;
        material.depthTest = true;
        material.depthWrite = false;
        material.needsUpdate = true;
      }
    });
  }

  let dragTint = null;
  function disposeDragTint() {
    if (!dragTint) return;
    dragTint.traverse?.(node => {
      if (!node.userData?.ephDragTintMaterial || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => material?.dispose?.());
    });
    dragTint.parent?.remove?.(dragTint);
    dragTint = null;
  }

  function makeDragTint(viewport) {
    const T = THREE();
    const root = viewport?.transform?.object;
    if (!T || !root) return null;
    const group = new T.Group();
    group.name = 'EPH_SelectionDragTintV47';
    group.userData.ephSelectionHighlight = true;
    group.raycast = () => {};

    const cloneSkeleton = window.EPH_THREE_HELPERS?.cloneSkeleton;
    for (const child of [...root.children]) {
      if (!child?.visible || child.userData?.ephSelectionHighlight || child.userData?.ephTransformGizmo || /^EPH_HammerSelection/i.test(String(child.name || ''))) continue;
      let clone = null;
      try { clone = cloneSkeleton ? cloneSkeleton(child) : child.clone(true); } catch { try { clone = child.clone(true); } catch {} }
      if (!clone) continue;
      clone.traverse?.(node => {
        node.userData ||= {};
        node.userData.ephSelectionHighlight = true;
        node.raycast = () => {};
        if (node.isMesh || node.isSkinnedMesh) {
          node.material = new T.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: SELECTION_FILL_OPACITY, depthTest: true, depthWrite: false, side: T.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
          node.userData.ephDragTintMaterial = true;
          node.castShadow = false;
          node.receiveShadow = false;
          node.renderOrder = 10030;
        } else if (node.isLight || node.isCamera) node.visible = false;
      });
      group.add(clone);
    }
    if (!group.children.length) return null;
    root.add(group);
    return group;
  }

  function installSelectionPerformance() {
    const viewport = window.EPH3D || state()?.viewport;
    const selection = window.EPH_HAMMER_SELECTION_V46;
    if (!viewport?.transform || !selection || viewport.__ephSelectionPerformanceV47) return false;
    viewport.__ephSelectionPerformanceV47 = true;

    const tuneLater = () => queueMicrotask(() => tuneSelectionOpacity(viewport));
    for (const name of ['select', 'setObjects', 'updateObject']) {
      const previous = viewport[name];
      if (typeof previous !== 'function' || previous.__ephSelectionTuneV47) continue;
      const wrapped = function(...args) {
        if (name === 'setObjects') {
          try { this.resize?.(); } catch {}
        }
        const result = previous.apply(this, args);
        tuneLater();
        return result;
      };
      for (const property of Object.keys(previous)) if (property.startsWith('__eph')) wrapped[property] = previous[property];
      wrapped.__ephSelectionTuneV47 = true;
      wrapped.__ephPrevious = previous;
      viewport[name] = wrapped;
    }

    viewport.transform.addEventListener('dragging-changed', event => {
      if (event.value) {
        selection.clear?.();
        disposeDragTint();
        dragTint = makeDragTint(viewport);
      } else {
        disposeDragTint();
        queueMicrotask(() => {
          selection.rebuild?.(viewport, true);
          tuneSelectionOpacity(viewport);
        });
      }
    });

    tuneLater();
    return true;
  }

  function finalInstall() {
    installAngleUiFix();
    sanitizeFgdInputTypes();
    installLazyAssetBrowser();
    stabilizeEntityRenderer();
    installSelectionPerformance();
  }

  installAngleUiFix();
  window.addEventListener('eph-fgd-catalog-ready', () => sanitizeFgdInputTypes());
  window.addEventListener('eph3d-ready', () => queueMicrotask(() => {
    installAngleUiFix();
    installLazyAssetBrowser();
  }));
  window.addEventListener('eph-runtime-ready', () => queueMicrotask(finalInstall), { once: true });
  queueMicrotask(() => {
    installAngleUiFix();
    installLazyAssetBrowser();
  });
})();
