// byanca
(() => {
  if (window.__ephHammerFidelityUi) return;
  window.__ephHammerFidelityUi = true;

  const sizeCache = new Map();

  async function textureSizeFor(materialPath) {
    if (!materialPath || materialPath === 'ERROR') return [512, 512];
    if (sizeCache.has(materialPath)) return sizeCache.get(materialPath);
    const pending = (async () => {
      try {
        const result = await api.materialPreview(materialPath);
        if (!result?.ok || !result.url) return [512, 512];
        return await new Promise(resolve => {
          const image = new Image();
          image.onload = () => resolve([Math.max(1, image.naturalWidth || image.width || 512), Math.max(1, image.naturalHeight || image.height || 512)]);
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

  const originalApplyMaterial = applyMaterial;
  applyMaterial = function(path) {
    const object = ensureObject(current());
    const faces = object?.type === 'part' ? [...S.selectedFaces] : [];
    originalApplyMaterial(path);
    if (!object || object.type !== 'part' || !faces.length) return;
    textureSizeFor(path).then(([width, height]) => {
      if (!S.objects.includes(object) || !window.EPH_HAMMER_FIDELITY) return;
      window.EPH_HAMMER_FIDELITY.setFaceMaterialInfo(object, faces, width, height);
      VMAP.applyObjectToDocument(S.doc, object);
      S.viewport?.updateObject(object);
      if (current()?.id === object.id) renderProperties();
    });
  };

  const defaultMaterial = 'materials/dev/dev_measuregeneric01b.vmat';
  if (typeof CORE_MATERIALS !== 'undefined' && !CORE_MATERIALS.some(item => item.path === defaultMaterial)) {
    CORE_MATERIALS.unshift({ name: 'Dev Measure Generic 01B', path: defaultMaterial, kind: 'material', source: 'CS2 Dev' });
  }
})();
