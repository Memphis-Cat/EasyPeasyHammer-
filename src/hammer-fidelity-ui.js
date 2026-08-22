// byanca
(() => {
  if (window.__ephHammerFidelityUi) return;
  window.__ephHammerFidelityUi = true;

  const sizeCache = new Map();
  const repaired = new WeakSet();

  async function textureSizeFor(materialPath) {
    if (!materialPath || materialPath === 'ERROR') return [512, 512];
    if (sizeCache.has(materialPath)) return sizeCache.get(materialPath);
    const pending = (async () => {
      try {
        const result = await api.materialPreview(materialPath);
        if (!result?.ok || !result.url) return [512, 512];
        const directWidth = Number(result.width);
        const directHeight = Number(result.height);
        if (directWidth > 0 && directHeight > 0) return [directWidth, directHeight];
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

  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;
  const axisIs = (axis, target) => Array.isArray(axis) && target.every((value, i) => near(axis[i], value));
  const uvLooksOldSquare = uv => Array.isArray(uv) && uv.length >= 3 && uv.every(pair => Array.isArray(pair) && pair.length >= 2 && [0, 1].some(v => near(pair[0], v)) && [0, 1].some(v => near(pair[1], v)));

  function looksLikeLegacyEasyPeasyMapping(object) {
    if (!object || object.type !== 'part' || !object.faces?.length || !object.faceUVs?.length) return false;
    let badVerticalFace = false;
    for (let i = 0; i < object.faces.length; i++) {
      const normal = VMAP.faceNormal(object.vertices, object.faces[i]);
      const vertical = Math.abs(normal[2]) < 0.8;
      if (!vertical) continue;
      if (uvLooksOldSquare(object.faceUVs[i]) && axisIs(object.faceTextureAxisU?.[i], [1, 0, 0, 0]) && axisIs(object.faceTextureAxisV?.[i], [0, -1, 0, 0])) {
        badVerticalFace = true;
        break;
      }
    }
    return badVerticalFace;
  }

  async function repairLegacyObject(object) {
    if (!looksLikeLegacyEasyPeasyMapping(object) || repaired.has(object) || !window.EPH_HAMMER_FIDELITY) return;
    repaired.add(object);
    const jobs = object.faces.map(async (_, faceIndex) => {
      const material = object.faceMaterials?.[faceIndex] || 'ERROR';
      const [width, height] = await textureSizeFor(material);
      window.EPH_HAMMER_FIDELITY.setFaceMaterialInfo(object, [faceIndex], width, height);
    });
    await Promise.all(jobs);
    if (!S.objects.includes(object)) return;
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport?.updateObject(object);
    if (current()?.id === object.id) renderProperties();
    log(`Repaired Hammer texture projection on ${object.name}`, 'success');
    markDirty(`Repaired texture projection on ${object.name}`);
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

  setInterval(() => {
    for (const object of S.objects || []) if (object?.type === 'part') repairLegacyObject(object);
  }, 650);
})();
