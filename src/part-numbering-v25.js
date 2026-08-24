// byanca
(() => {
  'use strict';
  if (window.__ephPartNumberingV25) return;
  window.__ephPartNumberingV25 = true;

  let activeCounterKey = '';
  let highWater = 0;

  function partNumberFromName(name) {
    const match = String(name || '').trim().match(/^part(?:[\s_-]*)(\d+)$/i);
    return match ? Number(match[1]) : null;
  }

  function counterKey() {
    const project = S?.project;
    const identity = String(project?.id || project?.vmapPath || project?.path || project?.name || 'unsaved-map');
    return `eph-part-high-water-v26:${identity}`;
  }

  function observedHighest() {
    let highest = 0;
    for (const object of S?.objects || []) {
      const number = partNumberFromName(object?.name);
      if (Number.isInteger(number) && number > highest) highest = number;
    }
    // During the current editor session a Part may already have been consumed by
    // CSG or deleted. Keep those numbers reserved too instead of immediately
    // recycling them just because the object is no longer present.
    for (const entry of S?.logs || []) {
      const text = String(entry?.message || '');
      for (const match of text.matchAll(/\bPart[_\s-]*(\d+)\b/gi)) {
        const number = Number(match[1]);
        if (Number.isInteger(number) && number > highest) highest = number;
      }
    }
    return highest;
  }

  function syncHighWater() {
    const key = counterKey();
    if (key !== activeCounterKey) {
      activeCounterKey = key;
      highWater = 0;
    }
    let stored = 0;
    try { stored = Number(localStorage.getItem(key) || 0) || 0; } catch {}
    highWater = Math.max(highWater, stored, observedHighest());
    return highWater;
  }

  function persistHighWater() {
    if (!activeCounterKey) activeCounterKey = counterKey();
    try { localStorage.setItem(activeCounterKey, String(highWater)); } catch {}
  }

  function nextPartNumber() {
    return syncHighWater() + 1;
  }

  function nextPartName() {
    highWater = nextPartNumber();
    persistHighWater();
    return `Part_${String(highWater).padStart(3, '0')}`;
  }

  function reserveExistingNames() {
    syncHighWater();
    persistHighWater();
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

  // Replace the renderer functions so every creation path uses one monotonic
  // Part sequence. Numbers are never recycled after delete, conversion or CSG.
  addPart = uniqueAddPart;
  duplicate = uniqueDuplicate;
  window.addPart = uniqueAddPart;
  window.duplicate = uniqueDuplicate;
  window.EPH_PART_NUMBERING = { nextPartName, nextPartNumber, reserveExistingNames };

  const rebind = () => {
    reserveExistingNames();
    const add = document.getElementById('topAddPart');
    const dup = document.getElementById('toolbarDuplicate');
    if (add) add.onclick = uniqueAddPart;
    if (dup) dup.onclick = uniqueDuplicate;
  };
  rebind();
  queueMicrotask(rebind);
  window.addEventListener('eph-runtime-ready', rebind, { once: true });

  console.info('[Part Numbering V25] Monotonic unique Part names enabled; deleted/converted/CSG numbers are not reused.');
})();
