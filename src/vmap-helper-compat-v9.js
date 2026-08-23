// byanca
(() => {
  const VMAP = window.EPH_VMAP;
  if (!VMAP || VMAP.__ephHelperCompatV9) return;
  VMAP.__ephHelperCompatV9 = true;

  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const get = (element, key, fallback = null) => field(element, key)?.value ?? fallback;
  const elem = (element, key) => {
    const value = get(element, key);
    return value?.kind === 'element' ? value : null;
  };
  const walk = (element, callback) => {
    if (!element?.kind) return;
    callback(element);
    for (const item of element.fields || []) {
      if (Array.isArray(item.value)) item.value.forEach(value => value?.kind && walk(value, callback));
      else if (item.value?.kind) walk(item.value, callback);
    }
  };
  const isHelper = element => element?.className === 'CMapMesh' && String(get(elem(element, 'meshData'), 'name', '')).startsWith(VMAP.HELPER_PREFIX);
  const setMissing = (element, key, type, value) => {
    if (field(element, key)) return;
    element.fields.push({ key, type, value });
  };

  function helperIds(doc) {
    const ids = [];
    for (const top of doc?.elements || []) walk(top, element => {
      if (!isHelper(element)) return;
      const id = String(get(element, 'id', ''));
      if (id) ids.push(id);
    });
    return [...new Set(ids)];
  }

  function completeHelperNode(element) {
    setMissing(element, 'customVisGroup', 'string', '');
    setMissing(element, 'disableShadows', 'int', '0');
    setMissing(element, 'bakelighting', 'bool', '1');
    setMissing(element, 'cubeMapName', 'string', '');
    setMissing(element, 'emissiveLightingEnabled', 'bool', '1');
    setMissing(element, 'emissiveLightingBoost', 'float', '1');
    setMissing(element, 'lightingDummy', 'bool', '0');
    setMissing(element, 'visexclude', 'bool', '0');
    setMissing(element, 'disablemerging', 'bool', '0');
    setMissing(element, 'renderwithdynamic', 'bool', '0');
    setMissing(element, 'renderToCubemaps', 'bool', '1');
    setMissing(element, 'keep_vertices', 'bool', '0');
    setMissing(element, 'fademindist', 'float', '-1');
    setMissing(element, 'fademaxdist', 'float', '0');
    setMissing(element, 'disableHeightDisplacement', 'bool', '0');
    setMissing(element, 'smoothingAngle', 'float', '40');
    setMissing(element, 'tintColor', 'color', '255 255 255 255');
    setMissing(element, 'renderAmt', 'int', '255');
    setMissing(element, 'physicsCollisionProperty', 'string', '');
    setMissing(element, 'physicsGroup', 'string', '');
    setMissing(element, 'physicsInteractsAs', 'string', '');
    setMissing(element, 'physicsInteractsWith', 'string', '');
    setMissing(element, 'physicsInteractsExclude', 'string', '');
    setMissing(element, 'physicsSimplificationOverride', 'bool', '0');
    setMissing(element, 'physicsSimplificationError', 'float', '0');
  }

  const previous = VMAP.syncCollisionHelpers.bind(VMAP);
  VMAP.syncCollisionHelpers = function(doc, objects) {
    for (const id of helperIds(doc)) VMAP.removeObject(doc, { dmxId: id });
    const result = previous(doc, objects);
    for (const top of doc?.elements || []) walk(top, element => { if (isHelper(element)) completeHelperNode(element); });
    return result;
  };
})();
