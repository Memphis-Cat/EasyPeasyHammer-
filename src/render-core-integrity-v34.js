// byanca
(() => {
  'use strict';
  if (window.__ephRenderCoreIntegrityV34) return;
  window.__ephRenderCoreIntegrityV34 = true;

  const api = window.easyPeasyHammer;
  const DEFAULT_POSITION = [700, -900, 650];
  const DEFAULT_TARGET = [0, 0, 64];
  const DEFAULT_FOV = 65;
  let installedViewport = null;
  let wrappedLoadProject = null;
  let repairing = false;

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Render Core V34] ${message}`, meta || '');
    try { api?.appLog?.(level, 'render-core-v34', message, meta)?.catch?.(() => {}); } catch {}
  }

  function vp() { return (typeof S !== 'undefined' ? S?.viewport : null) || window.EPH3D || null; }
  function finiteNumber(value) { return Number.isFinite(Number(value)); }
  function finiteArray(value, count) { return Array.isArray(value) && value.length >= count && value.slice(0, count).every(finiteNumber); }
  function validCameraState(state) {
    if (!state || !finiteArray(state.position, 3) || !finiteArray(state.target, 3)) return false;
    const fov = Number(state.fov ?? DEFAULT_FOV);
    if (!Number.isFinite(fov) || fov < 5 || fov > 150) return false;
    const dx = Number(state.position[0]) - Number(state.target[0]);
    const dy = Number(state.position[1]) - Number(state.target[1]);
    const dz = Number(state.position[2]) - Number(state.target[2]);
    return Number.isFinite(dx + dy + dz) && dx * dx + dy * dy + dz * dz > 0.01;
  }

  function resetCamera(viewport) {
    if (!viewport?.camera || !viewport?.orbit) return;
    viewport.camera.position.fromArray(DEFAULT_POSITION);
    viewport.orbit.target.fromArray(DEFAULT_TARGET);
    viewport.camera.fov = DEFAULT_FOV;
    viewport.camera.near = 0.1;
    viewport.camera.far = Math.max(500000, Number(viewport.camera.far) || 0);
    viewport.camera.up.set(0, 0, 1);
    viewport.camera.updateProjectionMatrix();
    viewport.orbit.update();
  }

  function repairCamera(viewport) {
    if (!viewport?.camera || !viewport?.orbit) return false;
    const state = viewport.getCameraState?.() || {
      position: viewport.camera.position.toArray(),
      target: viewport.orbit.target.toArray(),
      fov: viewport.camera.fov,
    };
    if (!validCameraState(state)) {
      resetCamera(viewport);
      report('warning', 'Invalid camera state was reset.', state);
      return true;
    }
    viewport.camera.near = 0.1;
    viewport.camera.far = Math.max(500000, Number(viewport.camera.far) || 0);
    viewport.camera.updateProjectionMatrix();
    return false;
  }

  function ensureSize(viewport) {
    if (!viewport?.renderer || !viewport?.container) return false;
    const width = Math.floor(viewport.container.clientWidth || viewport.container.getBoundingClientRect?.().width || 0);
    const height = Math.floor(viewport.container.clientHeight || viewport.container.getBoundingClientRect?.().height || 0);
    if (width < 2 || height < 2) return false;
    const pixelRatio = viewport.renderer.getPixelRatio?.() || 1;
    const canvas = viewport.renderer.domElement;
    const expectedW = Math.max(1, Math.round(width * pixelRatio));
    const expectedH = Math.max(1, Math.round(height * pixelRatio));
    if (Math.abs((canvas?.width || 0) - expectedW) > 2 || Math.abs((canvas?.height || 0) - expectedH) > 2) {
      viewport.renderer.setSize(width, height, false);
      viewport.camera.aspect = width / height;
      viewport.camera.updateProjectionMatrix();
      report('warning', 'Repaired stale WebGL backing-buffer size.', { width, height, canvasWidth: canvas?.width, canvasHeight: canvas?.height, pixelRatio });
    } else {
      viewport.camera.aspect = width / height;
      viewport.camera.updateProjectionMatrix();
    }
    return true;
  }

  function ensureScene(viewport) {
    const THREE = window.EPH_THREE || window.THREE;
    if (!viewport?.scene || !THREE) return;
    if (viewport.objectGroup && viewport.objectGroup.parent !== viewport.scene) viewport.scene.add(viewport.objectGroup);
    if (viewport.editGroup && viewport.editGroup.parent !== viewport.scene) viewport.scene.add(viewport.editGroup);
    if (viewport.transform?.getHelper) {
      const helper = viewport.transform.getHelper();
      if (helper && helper.parent !== viewport.scene) viewport.scene.add(helper);
    }
    if (!viewport.gridHelper || viewport.gridHelper.parent !== viewport.scene) {
      try { viewport.makeGrid?.(); } catch (error) { report('error', 'Could not rebuild the Hammer grid.', error?.message || String(error)); }
    }
    if (viewport.gridHelper) viewport.gridHelper.visible = typeof S === 'undefined' ? true : S.grid !== false;
    viewport.scene.background = new THREE.Color(0x111318);
    try { viewport.renderer?.setClearColor?.(0x111318, 1); } catch {}

    if (!viewport.scene.children.some(child => child?.isHemisphereLight)) viewport.scene.add(new THREE.HemisphereLight(0xcbd8ff, 0x3b3540, 1.65));
    if (!viewport.scene.children.some(child => child?.isDirectionalLight)) {
      const sun = new THREE.DirectionalLight(0xffffff, 2.0);
      sun.position.set(-600, -800, 1400);
      viewport.scene.add(sun);
    }
  }

  function isLargeMap() { return Boolean(window.EPH_LARGE_STREAM?.active?.()); }
  function renderable(object) { return Boolean(object?.id && !['world', 'folder'].includes(object.type) && object.visible !== false); }
  function objectById(id) { return (typeof S !== 'undefined' ? S.objects || [] : []).find(object => object?.id === id) || null; }
  function rootHasVisual(root) {
    if (!root) return false;
    let found = false;
    root.traverse?.(node => {
      if (node !== root && (node.isMesh || node.isLine || node.isLineSegments || node.isPoints || node.isSprite || node.isLight)) found = true;
    });
    return found;
  }

  function disposeRoot(viewport, id) {
    const root = viewport?.objectRoots?.get?.(id);
    if (!root) return;
    try {
      if (viewport.transform?.object === root) viewport.transform.detach();
      viewport.objectGroup?.remove?.(root);
      viewport.disposeObject?.(root);
    } catch {}
    viewport.objectRoots.delete(id);
  }

  function ensureRoot(viewport, object, quiet = false) {
    if (!viewport?.objectRoots || !viewport?.objectGroup || !viewport?.createObjectRoot || !renderable(object)) return null;
    let root = viewport.objectRoots.get(object.id) || null;
    if (root && root.parent !== viewport.objectGroup) viewport.objectGroup.add(root);
    const needsVisual = ['part', 'terrain', 'decal', 'prop'].includes(object.type);
    if (root && needsVisual && !rootHasVisual(root)) {
      disposeRoot(viewport, object.id);
      root = null;
    }
    if (!root) {
      try {
        root = viewport.createObjectRoot(object);
        if (root) {
          viewport.objectGroup.add(root);
          viewport.objectRoots.set(object.id, root);
          if (!quiet) report('warning', `Rebuilt missing render root for ${object.name || object.id}.`, { id: object.id, type: object.type });
        }
      } catch (error) {
        report('error', `Could not build render root for ${object.name || object.id}.`, error?.stack || error?.message || String(error));
        return null;
      }
    }
    if (root) {
      root.visible = object.visible !== false;
      root.updateMatrixWorld?.(true);
    }
    return root;
  }

  function authoritativeNormalMapRebuild(viewport, objects, selectedId) {
    if (!viewport || isLargeMap() || repairing) return false;
    repairing = true;
    try {
      viewport.clearObjects?.();
      viewport.objects = Array.isArray(objects) ? objects : [];
      for (const object of viewport.objects) if (renderable(object)) ensureRoot(viewport, object, true);
      const selected = objectById(selectedId);
      viewport.selectedId = selected?.id || null;
      if (selected && viewport.objectRoots.has(selected.id)) viewport.select?.(selected.id, false);
      else {
        viewport.selectionBox && (viewport.selectionBox.visible = false);
        viewport.transform?.detach?.();
      }
      return true;
    } finally { repairing = false; }
  }

  function reconcile(viewport, options = {}) {
    if (!viewport) return;
    ensureScene(viewport);
    ensureSize(viewport);
    repairCamera(viewport);

    const objects = typeof S !== 'undefined' ? S.objects || [] : viewport.objects || [];
    if (!isLargeMap()) {
      const wanted = objects.filter(renderable);
      const wantedIds = new Set(wanted.map(object => object.id));
      let mismatch = viewport.objectRoots?.size !== wanted.length;
      if (!mismatch) {
        for (const object of wanted) {
          const root = viewport.objectRoots.get(object.id);
          if (!root || root.parent !== viewport.objectGroup || (['part', 'terrain', 'decal', 'prop'].includes(object.type) && !rootHasVisual(root))) { mismatch = true; break; }
        }
      }
      if (!mismatch) for (const id of viewport.objectRoots.keys()) if (!wantedIds.has(id)) { mismatch = true; break; }
      if (mismatch) {
        authoritativeNormalMapRebuild(viewport, objects, typeof S !== 'undefined' ? S.selectedId : viewport.selectedId);
        if (!options.quiet) report('warning', 'Reconciled editor objects with the Three.js scene.', { objects: wanted.length, roots: viewport.objectRoots.size });
      }
    } else {
      const selected = objectById(typeof S !== 'undefined' ? S.selectedId : viewport.selectedId);
      if (renderable(selected)) ensureRoot(viewport, selected, options.quiet);
    }
  }

  function focusSelected(viewport) {
    if (!viewport) return false;
    reconcile(viewport, { quiet: true });
    const selected = objectById(typeof S !== 'undefined' ? S.selectedId : viewport.selectedId);
    if (renderable(selected)) {
      const root = ensureRoot(viewport, selected);
      if (!root) return false;
      viewport.selectedId = selected.id;
      root.updateMatrixWorld?.(true);
      const THREE = window.EPH_THREE || window.THREE;
      const box = THREE ? new THREE.Box3().setFromObject(root) : null;
      if (box && !box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length(), 64);
        let dir = viewport.camera.position.clone().sub(viewport.orbit.target);
        if (![dir.x, dir.y, dir.z].every(Number.isFinite) || dir.lengthSq() < 0.0001) dir = new THREE.Vector3(0.75, -1, 0.65);
        dir.normalize();
        viewport.orbit.target.copy(center);
        viewport.camera.position.copy(center).add(dir.multiplyScalar(radius * 1.8));
        viewport.camera.lookAt(center);
        viewport.orbit.update();
        viewport.camera.updateProjectionMatrix();
      }
      return true;
    }
    viewport.frameAll?.();
    return true;
  }

  function installViewport(viewport = vp()) {
    if (!viewport?.renderer?.domElement || !viewport?.scene) return false;
    installedViewport = viewport;
    if (viewport.__ephRenderCoreV34) { reconcile(viewport, { quiet: true }); return true; }
    viewport.__ephRenderCoreV34 = true;

    const canvas = viewport.renderer.domElement;
    if (canvas.parentElement !== viewport.container) viewport.container?.appendChild?.(canvas);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      report('error', 'WebGL context was lost.', { objects: typeof S !== 'undefined' ? S.objects?.length || 0 : 0 });
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      report('warning', 'WebGL context restored; rebuilding visible scene.');
      setTimeout(() => { authoritativeNormalMapRebuild(viewport, typeof S !== 'undefined' ? S.objects || [] : viewport.objects || [], typeof S !== 'undefined' ? S.selectedId : viewport.selectedId); reconcile(viewport); }, 0);
    }, false);

    const rawUpdate = viewport.updateObject?.bind(viewport);
    if (rawUpdate) viewport.updateObject = function(object, ...args) {
      const result = rawUpdate(object, ...args);
      if (!repairing) queueMicrotask(() => {
        if (renderable(object)) ensureRoot(viewport, object, true);
        else if (object?.id) disposeRoot(viewport, object.id);
        ensureScene(viewport);
        ensureSize(viewport);
      });
      return result;
    };

    const rawSet = viewport.setObjects?.bind(viewport);
    if (rawSet) viewport.setObjects = function(objects, selectedId = null, ...args) {
      const result = rawSet(objects, selectedId, ...args);
      if (!repairing) queueMicrotask(() => reconcile(viewport));
      return result;
    };

    const rawCamera = viewport.setCameraState?.bind(viewport);
    if (rawCamera) viewport.setCameraState = function(state) {
      if (!validCameraState(state)) { resetCamera(viewport); return false; }
      rawCamera({ position: state.position.map(Number), target: state.target.map(Number), fov: Number(state.fov ?? DEFAULT_FOV) });
      repairCamera(viewport);
      return true;
    };

    // The viewport is constructed while editorScreen is hidden. A ResizeObserver
    // is not enough as the only recovery path: make visibility/resize explicit.
    window.addEventListener('resize', () => ensureSize(viewport), { passive: true });
    const editor = document.getElementById('editorScreen');
    if (editor) new MutationObserver(() => {
      if (!editor.classList.contains('hidden')) requestAnimationFrame(() => requestAnimationFrame(() => reconcile(viewport)));
    }).observe(editor, { attributes: true, attributeFilter: ['class'] });

    let frame = 0;
    const health = () => {
      if (viewport !== vp()) return;
      if ((frame++ % 60) === 0 && !document.getElementById('editorScreen')?.classList.contains('hidden')) {
        ensureSize(viewport);
        const context = viewport.renderer.getContext?.();
        if (context?.isContextLost?.()) report('error', 'WebGL context reports lost during render health check.');
      }
      requestAnimationFrame(health);
    };
    requestAnimationFrame(health);

    reconcile(viewport, { quiet: true });
    return true;
  }

  function installFocusKey() {
    if (document.documentElement.dataset.ephRenderFocusV34 === '1') return;
    document.documentElement.dataset.ephRenderFocusV34 = '1';
    window.addEventListener('keydown', event => {
      if (event.key?.toLowerCase() !== 'f' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      focusSelected(vp());
    }, true);
  }

  function installLoadProject() {
    const current = window.loadProject || (typeof loadProject === 'function' ? loadProject : null);
    if (typeof current !== 'function' || current.__ephRenderCoreV34) return Boolean(current);
    const raw = current;
    const wrapped = async function(project, ui, ...rest) {
      if (typeof S !== 'undefined') {
        if (!validCameraState(ui?.cameraState)) {
          S.camera = null;
          if (ui && Object.prototype.hasOwnProperty.call(ui, 'cameraState')) ui = { ...ui, cameraState: null };
        }
      }
      const result = await raw(project, ui, ...rest);
      if (!result) return result;
      installViewport(vp());
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const viewport = vp();
      reconcile(viewport);
      if (typeof S !== 'undefined' && !validCameraState(ui?.cameraState)) viewport?.frameAll?.();
      ensureSize(viewport);
      report('normal', 'Project render state verified after load.', {
        map: project?.name || null,
        streamed: isLargeMap(),
        objects: typeof S !== 'undefined' ? S.objects?.length || 0 : 0,
        roots: viewport?.objectRoots?.size || 0,
        canvas: viewport?.renderer?.domElement ? [viewport.renderer.domElement.width, viewport.renderer.domElement.height] : null,
      });
      return result;
    };
    wrapped.__ephRenderCoreV34 = true;
    wrapped.__ephPrevious = raw;
    try { loadProject = wrapped; } catch {}
    window.loadProject = wrapped;
    wrappedLoadProject = wrapped;
    return true;
  }

  function installLargeMapCleanup() {
    const stream = window.EPH_LARGE_STREAM;
    if (!stream?.close || stream.close.__ephRenderCoreV34) return false;
    const rawClose = stream.close.bind(stream);
    stream.close = async function(...args) {
      const result = await rawClose(...args);
      const viewport = vp();
      if (viewport) {
        ensureScene(viewport);
        ensureSize(viewport);
        repairCamera(viewport);
      }
      return result;
    };
    stream.close.__ephRenderCoreV34 = true;
    stream.close.__ephPrevious = rawClose;
    return true;
  }

  installViewport();
  installFocusKey();
  installLoadProject();
  installLargeMapCleanup();
  window.addEventListener('eph3d-ready', event => installViewport(event.detail), { once: true });
  window.EPH_RENDER_INTEGRITY = { reconcile: () => reconcile(vp()), focus: () => focusSelected(vp()), validCameraState };
  report('normal', 'Authoritative canvas, camera, scene and render-root integrity guard installed.');
})();
