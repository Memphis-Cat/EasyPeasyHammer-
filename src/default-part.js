// byanca
(() => {
  const DEFAULT_PART_MATERIAL = 'materials/dev/dev_measuregeneric01b.vmat';
  let defaultTextureSize = null;
  let defaultTextureSizePromise = null;

  try {
    if (Array.isArray(CORE_MATERIALS) && !CORE_MATERIALS.some(item => item.path === DEFAULT_PART_MATERIAL)) {
      CORE_MATERIALS.splice(1, 0, {
        name: 'Dev Measure Generic 01B',
        path: DEFAULT_PART_MATERIAL,
        kind: 'material',
        source: 'CS2 Dev'
      });
    }
  } catch {}

  async function getDefaultTextureSize() {
    if (defaultTextureSize) return defaultTextureSize;
    if (defaultTextureSizePromise) return defaultTextureSizePromise;
    defaultTextureSizePromise = (async () => {
      try {
        const result = await api.materialPreview(DEFAULT_PART_MATERIAL);
        if (!result?.ok || !result.url) return [512, 512];
        const width = Number(result.width);
        const height = Number(result.height);
        if (width > 0 && height > 0) return [width, height];
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
    defaultTextureSize = await defaultTextureSizePromise;
    return defaultTextureSize;
  }

  function createPartWithDefaultMaterial() {
    if (!S.doc) return;
    pushHistory();
    const materials = Object.fromEntries(VMAP.FACE_NAMES.map(face => [face, DEFAULT_PART_MATERIAL]));
    const object = ensureObject(VMAP.addPart(S.doc, {
      size: [128, 128, 128],
      position: [0, 0, 64],
      collision: true,
      materials
    }));

    object.faceMaterials = object.faces.map(() => DEFAULT_PART_MATERIAL);
    object.materials = materials;
    object.name = `Part_${String(S.objects.filter(item => item.type === 'part').length + 1).padStart(3, '0')}`;
    object.blockPlayers = true;
    S.objects.push(object);
    S.selectedId = object.id;
    S.selectedFaces = new Set([0]);

    if (S.viewport) {
      S.viewport.objects = S.objects;
      S.viewport.updateObject(object);
      S.viewport.select(object.id, false);
    }
    setTool('move');
    markDirty(`Created ${object.name}`);
    renderTree();
    renderProperties();

    getDefaultTextureSize().then(([width, height]) => {
      if (!S.objects.includes(object) || !window.EPH_HAMMER_FIDELITY) return;
      const faces = object.faces.map((_, index) => index);
      window.EPH_HAMMER_FIDELITY.setFaceMaterialInfo(object, faces, width, height);
      VMAP.applyObjectToDocument(S.doc, object);
      S.viewport?.updateObject(object);
      if (current()?.id === object.id) renderProperties();
    });
  }

  addPart = createPartWithDefaultMaterial;
  const topAddPart = document.getElementById('topAddPart');
  if (topAddPart) topAddPart.onclick = createPartWithDefaultMaterial;
})();
