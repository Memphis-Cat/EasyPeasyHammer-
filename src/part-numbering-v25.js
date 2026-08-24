// byanca
(() => {
  'use strict';
  if (window.__ephPartNumberingV25) return;
  window.__ephPartNumberingV25 = true;

  function partNumberFromName(name) {
    const match = String(name || '').trim().match(/^part(?:[\s_-]*)(\d+)$/i);
    return match ? Number(match[1]) : null;
  }

  function nextPartNumber() {
    let highest = 0;
    for (const object of S?.objects || []) {
      if (object?.type !== 'part') continue;
      const number = partNumberFromName(object.name);
      if (Number.isInteger(number) && number > highest) highest = number;
    }
    return highest + 1;
  }

  function nextPartName() {
    return `Part_${String(nextPartNumber()).padStart(3, '0')}`;
  }

  function copyEditorFlags(source, target) {
    if (!source || !target) return;
    for (const key of ['blockPlayers', 'blockGrenades', 'blockBullets', 'collision', 'visible']) {
      if (source[key] !== undefined) target[key] = structuredClone(source[key]);
    }
    if (source.size) target.size = structuredClone(source.size);
    if (source.ephNegative !== undefined) target.ephNegative = Boolean(source.ephNegative);
  }

  function uniqueAddPart() {
    if (!S?.doc) return;
    pushHistory?.();
    const name = nextPartName();
    const object = ensureObject(VMAP.addPart(S.doc, {
      size: [128, 128, 128],
      position: [0, 0, 64],
      collision: true,
      materials: Object.fromEntries(VMAP.FACE_NAMES.map(face => [face, 'ERROR']))
    }));
    object.name = name;
    object.blockPlayers = true;
    S.objects.push(object);
    S.selectedId = object.id;
    S.selectedFaces = new Set([0]);
    S.viewport?.setObjects?.(S.objects, S.selectedId);
    setTool?.('move');
    markDirty?.(`Created ${object.name}`);
    renderTree?.();
    renderProperties?.();
    window.EPH_NEGATIVE_BRUSH?.refresh?.();
    return object;
  }

  function uniqueDuplicate() {
    const source = current?.();
    if (!source?.dmxId) return;
    pushHistory?.();
    const copy = ensureObject(VMAP.duplicateObject(S.doc, source));
    if (!copy) {
      S.undo?.pop?.();
      return;
    }

    copyEditorFlags(source, copy);
    if (copy.type === 'part') copy.name = nextPartName();
    else copy.name = `${source.name || copy.name || 'Object'}_copy`;

    S.objects.push(copy);
    S.selectedId = copy.id;
    S.selectedFaces = new Set([0]);
    VMAP.applyObjectToDocument?.(S.doc, copy);
    S.viewport?.setObjects?.(S.objects, copy.id);
    markDirty?.(`Duplicated as ${copy.name}`);
    renderTree?.();
    renderProperties?.();
    window.EPH_NEGATIVE_BRUSH?.refresh?.();
    return copy;
  }

  // Replace the renderer functions so every creation path uses the same
  // monotonically increasing Part_001 / Part_002 / Part_003 naming rule.
  addPart = uniqueAddPart;
  duplicate = uniqueDuplicate;
  window.addPart = uniqueAddPart;
  window.duplicate = uniqueDuplicate;
  window.EPH_PART_NUMBERING = { nextPartName, nextPartNumber };

  const rebind = () => {
    const add = document.getElementById('topAddPart');
    const dup = document.getElementById('toolbarDuplicate');
    if (add) add.onclick = uniqueAddPart;
    if (dup) dup.onclick = uniqueDuplicate;
  };
  rebind();
  queueMicrotask(rebind);
  window.addEventListener('eph-runtime-ready', rebind, { once: true });

  console.info('[Part Numbering V25] Sequential unique part names enabled.');
})();
