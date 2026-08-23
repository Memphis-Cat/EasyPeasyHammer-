// byanca
(() => {
  'use strict';
  if (window.__ephEditorStabilityV28) return;
  window.__ephEditorStabilityV28 = true;

  const MAX_PROPERTY_FACES = 180;
  const THUMB_WORKERS = 6;
  const materialPreviewCache = new Map();
  let thumbEpoch = 0;
  let viewportInstalled = null;

  function report(message, meta = null) {
    console.info(`[Editor Stability V28] ${message}`, meta || '');
    window.easyPeasyHammer?.appLog?.('normal', 'editor-stability-v28', message, meta).catch?.(() => {});
  }

  function largeMapActive() {
    return Boolean(window.EPH_LARGE_STREAM?.active?.());
  }

  function basicExtra(object) {
    const value = {
      name: object.name,
      size: object.size,
      collision: object.collision,
      blockPlayers: object.blockPlayers,
      blockGrenades: object.blockGrenades,
      blockBullets: object.blockBullets,
      visible: object.visible,
      className: object.className,
      model: object.model,
    };
    if (object.ephNegative) value.ephNegative = true;
    return value;
  }

  function installSerializationFastPath() {
    if (typeof workingText === 'function' && !workingText.__ephV28) {
      const fastWorkingText = function() {
        return S?.doc ? VMAP.stringify(S.doc) : '';
      };
      fastWorkingText.__ephV28 = true;
      try { workingText = fastWorkingText; } catch {}
      window.workingText = fastWorkingText;
    }

    if (typeof saveText === 'function' && !saveText.__ephV28) {
      const fastSaveText = function() {
        if (!S?.doc) return '';
        return VMAP.stringify(VMAP.prepareForSave(S.doc, S.objects || []));
      };
      fastSaveText.__ephV28 = true;
      try { saveText = fastSaveText; } catch {}
      window.saveText = fastSaveText;
    }

    if (typeof uiSnapshot === 'function' && !uiSnapshot.__ephV28) {
      const fastSnapshot = function() {
        const large = largeMapActive();
        const collab = Boolean(window.EPH_COLLAB?.state?.()?.connected);
        let objectExtras;
        if (large) {
          objectExtras = {};
          for (const object of S.objects || []) {
            if (!object?.dmxId || object.ephLargeProxy) continue;
            if (!object.ephLargeDirty && !object.ephNegative && object.ephLargeStreamed) continue;
            objectExtras[object.id] = basicExtra(object);
          }
        } else objectExtras = typeof extras === 'function' ? extras() : {};

        const snapshot = {
          phase: collab ? 4 : 3,
          tool: S.tool,
          assetTab: S.assetTab,
          bottomTab: S.bottomTab,
          selectedId: S.selectedId,
          selectedFaces: [...(S.selectedFaces || [])],
          grid: S.grid,
          gridSize: S.gridSize,
          snap: S.snap,
          angleSnap: S.angleSnap,
          space: S.space,
          view: S.view,
          shading: S.shading,
          cameraState: S.viewport?.getCameraState?.() || S.camera,
          objectExtras,
          clipAxis: S.clipAxis,
          clipPlane: S.clipPlane,
          clipPositive: S.clipPositive,
        };

        // Collaboration snapshots need the complete document even when the map
        // is currently clean. Session autosaves do not: omitting a clean map's
        // text avoids serializing tens/hundreds of MB every 15 seconds.
        if (collab && !large) snapshot.vmapText = workingText();
        else if (S.dirty && !large) snapshot.vmapText = workingText();
        if (large) snapshot.ephLargeMap = true;
        return snapshot;
      };
      fastSnapshot.__ephV28 = true;
      try { uiSnapshot = fastSnapshot; } catch {}
      window.uiSnapshot = fastSnapshot;
    }
  }

  function installTreeFastPath() {
    if (typeof renderTree !== 'function' || renderTree.__ephTreeFastV28) return;
    const rawTree = renderTree;
    const wrapped = function(...args) {
      const objects = S?.objects || [];
      const byParent = new Map();
      for (const object of objects) {
        const key = object.parent == null ? null : object.parent;
        let list = byParent.get(key);
        if (!list) { list = []; byParent.set(key, list); }
        list.push(object);
      }
      const rawChildren = typeof childrenOf === 'function' ? childrenOf : null;
      const rawIcons = typeof icons === 'function' ? icons : null;
      try {
        if (rawChildren) childrenOf = id => byParent.get(id) || [];
        // Base renderTree called icons(), which scans every image in the entire
        // document, once per row. Suppress that inner O(n²) scan and do it once.
        if (rawIcons) icons = () => {};
        return rawTree(...args);
      } finally {
        if (rawChildren) childrenOf = rawChildren;
        if (rawIcons) {
          icons = rawIcons;
          rawIcons();
        }
      }
    };
    wrapped.__ephTreeFastV28 = true;
    wrapped.__ephPrevious = rawTree;
    try { renderTree = wrapped; } catch {}
    window.renderTree = wrapped;
  }

  function installPropertyFaceLimit() {
    if (typeof renderProperties !== 'function' || renderProperties.__ephFaceLimitV28) return;
    const raw = renderProperties;
    const wrapped = function(...args) {
      const object = typeof current === 'function' ? current() : null;
      const faces = object?.type === 'part' && Array.isArray(object.faces) ? object.faces : null;
      if (!faces || faces.length <= MAX_PROPERTY_FACES) return raw(...args);

      const originalFaces = object.faces;
      const originalMaterials = object.faceMaterials;
      const selected = [...(S.selectedFaces || [])];
      const selectedIndex = selected.find(index => Number.isInteger(index) && index >= 0 && index < originalFaces.length);
      let result;
      try {
        object.faces = originalFaces.slice(0, MAX_PROPERTY_FACES);
        if (Array.isArray(originalMaterials)) object.faceMaterials = originalMaterials.slice(0, MAX_PROPERTY_FACES);
        result = raw(...args);
      } finally {
        object.faces = originalFaces;
        object.faceMaterials = originalMaterials;
      }

      const host = document.getElementById('propertiesContent');
      if (!host) return result;
      const title = [...host.querySelectorAll('.property-section-title')].find(node => node.textContent.trim() === 'Face Materials');
      const section = title?.closest('.property-section');
      if (section && !section.querySelector('.eph-face-limit-v28')) {
        const note = document.createElement('div');
        note.className = 'selection-info eph-face-limit-v28';
        note.textContent = `Showing ${MAX_PROPERTY_FACES.toLocaleString()} of ${originalFaces.length.toLocaleString()} faces to keep Properties responsive. Select any other face directly in the viewport.`;
        title.insertAdjacentElement('afterend', note);
      }
      if (Number.isInteger(selectedIndex) && selectedIndex >= MAX_PROPERTY_FACES) {
        const input = document.getElementById('selectedMaterial');
        if (input) input.value = originalMaterials?.[selectedIndex] || 'ERROR';
      }
      return result;
    };
    wrapped.__ephFaceLimitV28 = true;
    wrapped.__ephPrevious = raw;
    try { renderProperties = wrapped; } catch {}
    window.renderProperties = wrapped;
  }

  function installThumbnailFastPath() {
    if (typeof loadMaterialThumbs !== 'function' || loadMaterialThumbs.__ephThumbV28) return;
    const fast = async function(items) {
      const epoch = ++thumbEpoch;
      const list = Array.isArray(items) ? items : [];
      let next = 0;
      async function worker() {
        while (epoch === thumbEpoch) {
          const index = next++;
          if (index >= list.length) return;
          const item = list[index];
          const resource = String(item?.path || '');
          if (!resource || resource === 'ERROR') continue;
          if (!materialPreviewCache.has(resource)) {
            materialPreviewCache.set(resource, Promise.resolve(window.easyPeasyHammer?.materialPreview?.(resource)).catch(() => null));
            if (materialPreviewCache.size > 1000) materialPreviewCache.delete(materialPreviewCache.keys().next().value);
          }
          const result = await materialPreviewCache.get(resource);
          if (epoch !== thumbEpoch || String(S.assetItems?.[index]?.path || '') !== resource) continue;
          const thumb = document.querySelector(`[data-thumb="${index}"]`);
          if (result?.ok && result.url && thumb) {
            thumb.style.backgroundImage = `url("${String(result.url).replace(/"/g, '%22')}")`;
            thumb.classList.add('real-thumb');
            thumb.textContent = '';
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(THUMB_WORKERS, Math.max(1, list.length)) }, worker));
    };
    fast.__ephThumbV28 = true;
    try { loadMaterialThumbs = fast; } catch {}
    window.loadMaterialThumbs = fast;
  }

  function installInputGuard() {
    if (document.documentElement.dataset.ephNumericGuardV28 === '1') return;
    document.documentElement.dataset.ephNumericGuardV28 = '1';
    document.addEventListener('change', event => {
      const input = event.target?.closest?.('.prop-value');
      if (!input) return;
      const raw = String(input.value ?? '').trim();
      if (raw !== '' && Number.isFinite(Number(raw))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try { renderProperties?.(); } catch {}
      try { toast?.('Enter a valid number'); } catch {}
    }, true);
  }

  function installIncrementalViewport() {
    const viewport = S?.viewport || window.EPH3D;
    if (!viewport?.setObjects || !viewport?.objectRoots || !viewport?.objectGroup || viewport.__ephIncrementalSetV28) return false;
    viewport.__ephIncrementalSetV28 = true;
    viewportInstalled = viewport;
    const raw = viewport.setObjects.bind(viewport);
    let previous = new Map((viewport.objects || []).filter(object => object?.id).map(object => [object.id, object]));

    const wrapped = function(objects, selectedId = null) {
      const list = Array.isArray(objects) ? objects : [];
      if (largeMapActive()) {
        const result = raw(list, selectedId);
        previous = new Map(list.filter(object => object?.id).map(object => [object.id, object]));
        return result;
      }
      const next = new Map(list.filter(object => object?.id).map(object => [object.id, object]));
      const removed = [];
      const added = [];
      let changedReferences = 0;
      for (const [id, oldObject] of previous) {
        if (!next.has(id)) removed.push(id);
        else if (next.get(id) !== oldObject) changedReferences++;
      }
      for (const [id, object] of next) if (!previous.has(id)) added.push(object);

      // Initial loads, undo restores and remote snapshot replaces can change many
      // references and must use the authoritative full rebuild path. Common
      // create/delete/duplicate operations usually alter <=8 roots and can be
      // updated in place instead of destroying the entire scene.
      const incremental = previous.size > 0 && changedReferences === 0 && removed.length + added.length <= 8;
      if (!incremental) {
        const result = raw(list, selectedId);
        previous = next;
        return result;
      }

      for (const id of removed) {
        const root = this.objectRoots.get(id);
        if (!root) continue;
        if (this.selectedId === id) this.transform?.detach?.();
        this.objectGroup.remove(root);
        this.disposeObject?.(root);
        this.objectRoots.delete(id);
      }
      for (const object of added) {
        if (!object || ['world', 'folder'].includes(object.type) || object.visible === false) continue;
        const root = this.createObjectRoot?.(object);
        if (!root) continue;
        this.objectGroup.add(root);
        this.objectRoots.set(object.id, root);
      }
      this.objects = list;
      this.select?.(selectedId, false);
      previous = next;
      queueMicrotask(() => window.EPH_MULTI_SELECTION?.refresh?.());
      return undefined;
    };
    wrapped.__ephIncrementalSetV28 = true;
    wrapped.__ephPrevious = raw;
    viewport.setObjects = wrapped;
    return true;
  }

  function install() {
    installSerializationFastPath();
    installTreeFastPath();
    installPropertyFaceLimit();
    installThumbnailFastPath();
    installInputGuard();
    installIncrementalViewport();
  }

  install();
  [400, 1200, 2600, 4200].forEach(delay => setTimeout(() => {
    // Some earlier enhancement scripts replace these functions once during
    // startup. Re-install only at a few bounded settle points, never forever.
    if (!workingText?.__ephV28 || !saveText?.__ephV28 || !uiSnapshot?.__ephV28) installSerializationFastPath();
    if (!renderTree?.__ephTreeFastV28) installTreeFastPath();
    if (!renderProperties?.__ephFaceLimitV28) installPropertyFaceLimit();
    if (!loadMaterialThumbs?.__ephThumbV28) installThumbnailFastPath();
    if (viewportInstalled !== (S?.viewport || window.EPH3D)) installIncrementalViewport();
  }, delay));
  window.addEventListener('eph3d-ready', installIncrementalViewport, { once: true });
  report('Installed serialization, hierarchy, Properties, thumbnail and incremental viewport fixes.');
})();
