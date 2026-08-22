// byanca
(() => {
  if (window.__ephHammerFidelityUi) return;
  window.__ephHammerFidelityUi = true;

  const sizeCache = new Map();
  const projectionState = new WeakMap();
  const announced = new WeakSet();

  async function textureSizeFor(materialPath) {
    if (!materialPath || materialPath === 'ERROR') return [512, 512];
    if (sizeCache.has(materialPath)) return sizeCache.get(materialPath);

    const pending = (async () => {
      try {
        const result = await api.materialPreview(materialPath);
        if (!result?.ok) return [512, 512];

        const directWidth = Number(result.width);
        const directHeight = Number(result.height);
        if (directWidth > 0 && directHeight > 0) return [directWidth, directHeight];
        if (!result.url) return [512, 512];

        return await new Promise(resolve => {
          const image = new Image();
          image.onload = () => resolve([
            Math.max(1, image.naturalWidth || image.width || 512),
            Math.max(1, image.naturalHeight || image.height || 512),
          ]);
          image.onerror = () => resolve([512, 512]);
          image.src = result.url;
        });
      } catch {
        return [512, 512];
      }
    })();

    sizeCache.set(materialPath, pending);
    return pending;
  }

  function projectionKey(object) {
    if (!object || object.type !== 'part') return '';
    const vertices = (object.vertices || []).map(vertex => vertex.map(value => Number(value).toFixed(4)).join(',')).join(';');
    const materials = (object.faceMaterials || []).join('|');
    const scales = JSON.stringify(object.faceTextureScale || []);
    const axesU = JSON.stringify(object.faceTextureAxisU || []);
    const axesV = JSON.stringify(object.faceTextureAxisV || []);
    return `${materials}::${vertices}::${scales}::${axesU}::${axesV}`;
  }

  async function synchronizeProjection(object) {
    if (!object || object.type !== 'part' || !object.faces?.length || !window.EPH_TEXTURE_PROJECTION_V4) return;

    const key = projectionKey(object);
    const previousState = projectionState.get(object);
    if (previousState?.key === key || previousState?.pending === key) return;
    projectionState.set(object, { key: previousState?.key || null, pending: key });

    const sizes = await Promise.all(object.faces.map((_, faceIndex) => {
      const material = object.faceMaterials?.[faceIndex] || 'ERROR';
      return textureSizeFor(material);
    }));

    if (!S.objects.includes(object)) return;
    if (projectionKey(object) !== key) {
      projectionState.set(object, { key: null, pending: null });
      return;
    }

    const before = JSON.stringify(object.faceUVs || []);
    object.faceTextureSizes ??= [];
    sizes.forEach((size, faceIndex) => {
      object.faceTextureSizes[faceIndex] = [Math.max(1, Number(size[0]) || 512), Math.max(1, Number(size[1]) || 512)];
    });

    window.EPH_TEXTURE_PROJECTION_V4.projectObject(object);
    const after = JSON.stringify(object.faceUVs || []);
    projectionState.set(object, { key: projectionKey(object), pending: null });

    if (before === after) return;

    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport?.updateObject(object);
    if (current()?.id === object.id) renderProperties();

    if (!announced.has(object)) {
      announced.add(object);
      log(`Synchronized Hammer texture tiling on ${object.name}`, 'success');
    }
    markDirty(`Updated texture projection on ${object.name}`);
  }

  const originalFaceLabel = faceLabel;
  faceLabel = function(index, count) {
    const object = current();
    if (object?.type === 'part' && object.faces?.[index] && window.EPH_FIDELITY_V2?.semanticFaceName) {
      const name = window.EPH_FIDELITY_V2.semanticFaceName(object.vertices, object.faces[index]);
      const names = object.faces.map(face => window.EPH_FIDELITY_V2.semanticFaceName(object.vertices, face));
      if (new Set(names).size === names.length) return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return originalFaceLabel(index, count);
  };

  const originalApplyMaterial = applyMaterial;
  applyMaterial = function(path) {
    const object = ensureObject(current());
    const faces = object?.type === 'part' ? [...S.selectedFaces] : [];
    originalApplyMaterial(path);
    if (!object || object.type !== 'part' || !faces.length) return;

    textureSizeFor(path).then(([width, height]) => {
      if (!S.objects.includes(object) || !window.EPH_TEXTURE_PROJECTION_V4) return;
      window.EPH_TEXTURE_PROJECTION_V4.setFaceMaterialInfo(object, faces, width, height);
      projectionState.delete(object);
      VMAP.applyObjectToDocument(S.doc, object);
      S.viewport?.updateObject(object);
      if (current()?.id === object.id) renderProperties();
    });
  };

  const defaultMaterial = 'materials/dev/dev_measuregeneric01b.vmat';
  if (typeof CORE_MATERIALS !== 'undefined' && !CORE_MATERIALS.some(item => item.path === defaultMaterial)) {
    CORE_MATERIALS.unshift({ name: 'Dev Measure Generic 01B', path: defaultMaterial, kind: 'material', source: 'CS2 Dev' });
  }

  const synchronizeAll = () => {
    for (const object of S.objects || []) {
      if (object?.type === 'part') synchronizeProjection(object);
    }
  };

  setTimeout(synchronizeAll, 80);
  setInterval(synchronizeAll, 450);
})();
