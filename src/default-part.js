// byanca
(() => {
  const DEFAULT_PART_MATERIAL = 'materials/dev/dev_measuregeneric01b.vmat';

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
  }

  addPart = createPartWithDefaultMaterial;
  const topAddPart = document.getElementById('topAddPart');
  if (topAddPart) topAddPart.onclick = createPartWithDefaultMaterial;
})();
