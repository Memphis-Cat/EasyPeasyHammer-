// byanca
(() => {
  'use strict';
  if (window.__ephPropFidelityV37) return;
  window.__ephPropFidelityV37 = true;

  const ERROR_MODEL = 'models/dev/error.vmdl';
  const VMAP = window.EPH_VMAP;
  const THREE = window.EPH_THREE || window.THREE;
  const cloneSkeleton = window.EPH_THREE_HELPERS?.cloneSkeleton;
  let installedViewport = null;
  let wrappedAddProp = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);

  function clonePreviewModel(data) {
    if (!THREE || !cloneSkeleton || !data?.scene) return null;
    const model = cloneSkeleton(data.scene);
    model.traverse(child => {
      if (!child.isMesh) return;
      child.geometry = child.geometry?.clone?.() || child.geometry;
      if (Array.isArray(child.material)) child.material = child.material.map(material => material?.clone?.() || material);
      else if (child.material?.clone) child.material = child.material.clone();
      child.castShadow = false;
      child.receiveShadow = false;
    });

    // ValveResourceFormat exports Source 2 Z-up coordinates into glTF's Y-up
    // basis. Its conversion maps Source X->glTF Z, Y->glTF X, Z->glTF Y.
    // Convert that basis back exactly instead of the old +90 degree X-only
    // correction, which left every prop yawed -90 degrees in the editor.
    const basis = new THREE.Group();
    basis.name = 'Source2ModelBasis';
    basis.quaternion.set(0.5, 0.5, 0.5, 0.5);
    basis.scale.setScalar(Number(data.scale) || 39.37007874015748);
    basis.add(model);
    return basis;
  }

  function errorPlaceholder(viewport, size) {
    const dims = Array.isArray(size) ? size : [64, 64, 64];
    const geometry = new THREE.BoxGeometry(
      Math.max(4, Number(dims[0]) || 64),
      Math.max(4, Number(dims[1]) || 64),
      Math.max(4, Number(dims[2]) || 64)
    );
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.02,
      map: viewport.errorTexture || null
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.placeholder = true;
    mesh.userData.ephErrorModel = true;
    return mesh;
  }

  function installViewport(viewport = state()?.viewport || window.EPH3D) {
    if (!viewport || !THREE || !cloneSkeleton) return false;
    installedViewport = viewport;

    if (!viewport.createFaceMaterial?.__ephPropFidelityV37) {
      const wrappedMaterial = function(resource) {
        const value = String(resource || 'ERROR');
        const isError = value === 'ERROR' || /error|missing/i.test(value);
        const material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.8,
          metalness: 0.02,
          side: THREE.DoubleSide,
          map: this.errorTexture || null
        });
        material.userData.resource = value;
        material.userData.ephLoadingFallback = !isError;

        if (!isError) {
          Promise.resolve(this.loadMaterialTexture?.(value)).then(texture => {
            if (!texture || material.userData.disposed) return;
            material.map = texture;
            material.color.set(0xffffff);
            material.userData.ephLoadingFallback = false;
            material.needsUpdate = true;
          }).catch(() => {});
        }
        return material;
      };
      wrappedMaterial.__ephPropFidelityV37 = true;
      wrappedMaterial.__ephPrevious = viewport.createFaceMaterial;
      viewport.createFaceMaterial = wrappedMaterial;
    }

    if (!viewport.createPropVisual?.__ephPropFidelityV37) {
      const wrappedProp = function(object, root) {
        const group = new THREE.Group();
        group.userData.ephVisual = true;
        group.userData.ephPropPreview = true;

        let shown = errorPlaceholder(this, object?.size);
        group.add(shown);
        let realModelShown = false;
        let fallbackData = null;

        const replaceShown = visual => {
          if (!visual || !root?.parent) return false;
          if (shown) {
            group.remove(shown);
            try { this.disposeObject?.(shown); } catch {}
          }
          shown = visual;
          group.add(visual);
          if (this.selectedId === object.id) this.updateSelectionBox?.();
          return true;
        };

        // The real Source 2 error model is the default visual while a requested
        // model is still loading, and remains the visual if that model cannot be
        // decoded, is missing, unknown, or corrupt.
        Promise.resolve(this.loadModel?.(ERROR_MODEL)).then(data => {
          fallbackData = data || null;
          if (realModelShown || !data) return;
          replaceShown(clonePreviewModel(data));
        }).catch(() => {});

        const requested = String(object?.model || '').trim();
        if (!requested || requested.toLowerCase() === ERROR_MODEL) return group;

        Promise.resolve(this.loadModel?.(requested)).then(data => {
          if (!data) {
            console.warn(`[Prop Fidelity V37] Could not preview ${requested}; keeping ${ERROR_MODEL}.`);
            if (fallbackData && !realModelShown) replaceShown(clonePreviewModel(fallbackData));
            return;
          }
          realModelShown = true;
          replaceShown(clonePreviewModel(data));
        }).catch(error => {
          console.warn(`[Prop Fidelity V37] Model preview failed for ${requested}.`, error);
          if (fallbackData && !realModelShown) replaceShown(clonePreviewModel(fallbackData));
        });
        return group;
      };
      wrappedProp.__ephPropFidelityV37 = true;
      wrappedProp.__ephPrevious = viewport.createPropVisual;
      viewport.createPropVisual = wrappedProp;
    }

    // Rebuild visuals once so already-open maps immediately use the corrected
    // Source2<->glTF basis and loading/error fallbacks.
    if (!viewport.__ephPropFidelityRebuiltV37) {
      viewport.__ephPropFidelityRebuiltV37 = true;
      queueMicrotask(() => {
        try { viewport.setObjects?.(state()?.objects || [], state()?.selectedId || null); } catch {}
      });
    }
    return true;
  }

  function installAddProp() {
    if (typeof addProp !== 'function') return false;
    if (addProp.__ephPropFidelityV37) {
      wrappedAddProp = addProp;
      return true;
    }
    const previous = addProp;
    const wrapped = function(item, ...rest) {
      const s = state();
      const before = new Set((s?.objects || []).map(object => object?.id));
      const result = previous(item, ...rest);
      const created = (result?.type === 'prop' ? result : null)
        || (s?.objects || []).find(object => object?.type === 'prop' && !before.has(object.id));
      if (!created) return result;

      // New props are always non-solid/non-blocking by default. These remain
      // normal editable switches: the user can enable any of them afterwards.
      created.collision = false;
      created.blockPlayers = false;
      created.blockGrenades = false;
      created.blockBullets = false;
      created.entityProperties ||= {};
      created.entityProperties.solid = '0';
      VMAP?.applyObjectToDocument?.(s?.doc, created);
      s?.viewport?.updateObject?.(created);
      try { renderProperties?.(); } catch {}
      return result;
    };
    for (const key of Object.keys(previous)) if (key.startsWith('__eph')) wrapped[key] = previous[key];
    wrapped.__ephPropFidelityV37 = true;
    wrapped.__ephPrevious = previous;
    addProp = wrapped;
    window.addProp = wrapped;
    wrappedAddProp = wrapped;
    return true;
  }

  function install() {
    installViewport();
    installAddProp();
  }

  install();
  window.addEventListener('eph3d-ready', event => installViewport(event.detail));
  window.addEventListener('eph-runtime-ready', install, { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    installViewport(state()?.viewport || window.EPH3D);
    if (wrappedAddProp && addProp !== wrappedAddProp) installAddProp();
    if (checks >= 40) clearInterval(guard);
  }, 250);

  window.EPH_PROP_FIDELITY_V37 = {
    errorModel: ERROR_MODEL,
    install,
    reinstallViewport: () => installViewport(state()?.viewport || window.EPH3D)
  };
  console.info('[Prop Fidelity V37] Source2 model basis, ERROR fallbacks and non-colliding prop defaults installed.');
})();
